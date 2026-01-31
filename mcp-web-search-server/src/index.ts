#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";

// Create an MCP server for web search and internet access
const server = new McpServer({
  name: "web-search-server",
  version: "1.0.0",
});

// Configure axios with timeout and headers
const webClient = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
  },
});

// CORS proxies for bypassing restrictions
const corsProxies = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// Helper function to extract text from HTML
function extractTextFromHtml(html: string): { title: string; content: string; description: string } {
  const $ = cheerio.load(html);
  
  // Remove script, style, and other non-content elements
  $("script, style, noscript, nav, footer, header, aside, .ads, .advertisement").remove();
  
  // Get title
  const title = $("title").text().trim() || $("h1").first().text().trim() || "";
  
  // Get meta description
  const description = $('meta[name="description"]').attr("content") || 
                     $('meta[property="og:description"]').attr("content") || "";
  
  // Get main content
  let content = "";
  
  // Try to find main content areas
  const mainSelectors = ["main", "article", ".content", ".post", ".entry", "#content", "#main"];
  for (const selector of mainSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      content = element.text().trim();
      break;
    }
  }
  
  // Fallback to body if no main content found
  if (!content) {
    content = $("body").text().trim();
  }
  
  // Clean up whitespace
  content = content.replace(/\s+/g, " ").trim();
  
  // Limit content length
  if (content.length > 10000) {
    content = content.substring(0, 10000) + "...";
  }
  
  return { title, content, description };
}

// Tool: Web Search using DuckDuckGo
server.tool(
  "web_search",
  {
    query: z.string().describe("Search query to find information on the web"),
    max_results: z.number().min(1).max(20).optional().describe("Maximum number of results to return (default: 10)"),
  },
  async ({ query, max_results = 10 }) => {
    try {
      const results: Array<{ title: string; url: string; snippet: string; source: string }> = [];
      
      // Try DuckDuckGo Instant Answer API first
      try {
        const ddgResponse = await webClient.get(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
        );
        
        const data = ddgResponse.data;
        
        if (data.Abstract) {
          results.push({
            title: data.Heading || "DuckDuckGo Result",
            snippet: data.Abstract,
            url: data.AbstractURL || "",
            source: data.AbstractSource || "DuckDuckGo",
          });
        }
        
        if (data.Answer) {
          results.push({
            title: "Direct Answer",
            snippet: data.Answer,
            url: "",
            source: "DuckDuckGo",
          });
        }
        
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, 5)) {
            if (topic.Text) {
              results.push({
                title: topic.FirstURL ? new URL(topic.FirstURL).hostname : "Related",
                snippet: topic.Text,
                url: topic.FirstURL || "",
                source: "DuckDuckGo",
              });
            }
          }
        }
      } catch (e) {
        console.error("DuckDuckGo API error:", e);
      }
      
      // Try Wikipedia API for encyclopedic content
      try {
        const wikiResponse = await webClient.get(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
          { headers: { Accept: "application/json" } }
        );
        
        if (wikiResponse.data.extract && wikiResponse.data.extract.length > 50) {
          results.push({
            title: wikiResponse.data.title || query,
            snippet: wikiResponse.data.extract,
            url: wikiResponse.data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
            source: "Wikipedia",
          });
        }
      } catch (e) {
        // Wikipedia might not have an article for this query
      }
      
      // Scrape DuckDuckGo HTML for more results if needed
      if (results.length < max_results) {
        for (const getProxyUrl of corsProxies) {
          try {
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const proxyUrl = getProxyUrl(searchUrl);
            
            const response = await webClient.get(proxyUrl, { timeout: 10000 });
            const html = response.data;
            const $ = cheerio.load(html);
            
            $(".result").each((i, elem) => {
              if (results.length >= max_results) return false;
              
              const $elem = $(elem);
              const title = $elem.find(".result__a").text().trim();
              const url = $elem.find(".result__a").attr("href") || "";
              const snippet = $elem.find(".result__snippet").text().trim();
              
              if (title && snippet) {
                const isDuplicate = results.some(r => r.url === url || r.snippet === snippet);
                if (!isDuplicate) {
                  results.push({ title, url, snippet, source: "Web" });
                }
              }
            });
            
            if (results.length >= max_results) break;
          } catch (e) {
            continue;
          }
        }
      }
      
      // Check Hacker News for tech queries
      const techKeywords = ["programming", "software", "code", "developer", "tech", "api", "javascript", "python", "react", "ai", "machine learning", "startup"];
      if (techKeywords.some(kw => query.toLowerCase().includes(kw))) {
        try {
          const hnResponse = await webClient.get(
            `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=3`
          );
          
          for (const hit of hnResponse.data.hits || []) {
            if (results.length >= max_results) break;
            results.push({
              title: hit.title || "Hacker News",
              snippet: `${hit.points || 0} points | ${hit.num_comments || 0} comments | ${hit.author || "unknown"}`,
              url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
              source: "Hacker News",
            });
          }
        } catch (e) {
          // Ignore HN errors
        }
      }
      
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No search results found for: "${query}". Try rephrasing your query or using different keywords.`,
            },
          ],
        };
      }
      
      const formattedResults = results.slice(0, max_results).map((r, i) => 
        `${i + 1}. **${r.title}**\n   Source: ${r.source}\n   URL: ${r.url || "N/A"}\n   ${r.snippet}`
      ).join("\n\n");
      
      return {
        content: [
          {
            type: "text",
            text: `## Web Search Results for: "${query}"\n\nFound ${results.length} results:\n\n${formattedResults}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error performing web search: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Fetch URL Content
server.tool(
  "fetch_url",
  {
    url: z.string().url().describe("The URL to fetch content from"),
    extract_text: z.boolean().optional().describe("Extract clean text from HTML (default: true)"),
  },
  async ({ url, extract_text = true }) => {
    try {
      let response;
      
      // Try direct fetch first
      try {
        response = await webClient.get(url);
      } catch (e) {
        // Try through CORS proxies
        for (const getProxyUrl of corsProxies) {
          try {
            const proxyUrl = getProxyUrl(url);
            response = await webClient.get(proxyUrl);
            break;
          } catch (proxyError) {
            continue;
          }
        }
      }
      
      if (!response) {
        throw new Error("Failed to fetch URL through all available methods");
      }
      
      const contentType = response.headers["content-type"] || "";
      
      if (contentType.includes("application/json")) {
        return {
          content: [
            {
              type: "text",
              text: `## Content from: ${url}\n\nType: JSON\n\n\`\`\`json\n${JSON.stringify(response.data, null, 2)}\n\`\`\``,
            },
          ],
        };
      }
      
      if (contentType.includes("text/html") && extract_text) {
        const { title, content, description } = extractTextFromHtml(response.data);
        
        return {
          content: [
            {
              type: "text",
              text: `## Content from: ${url}\n\n**Title:** ${title}\n\n**Description:** ${description || "N/A"}\n\n**Content:**\n${content}`,
            },
          ],
        };
      }
      
      // Return raw text content
      const textContent = typeof response.data === "string" 
        ? response.data.substring(0, 15000) 
        : JSON.stringify(response.data).substring(0, 15000);
      
      return {
        content: [
          {
            type: "text",
            text: `## Content from: ${url}\n\n${textContent}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching URL "${url}": ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Get Current Date/Time
server.tool(
  "get_current_time",
  {
    timezone: z.string().optional().describe("Timezone (e.g., 'America/New_York', 'Europe/London'). Default: UTC"),
  },
  async ({ timezone = "UTC" }) => {
    try {
      const now = new Date();
      
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "long",
      });
      
      return {
        content: [
          {
            type: "text",
            text: `## Current Date and Time\n\n**Timezone:** ${timezone}\n**Date/Time:** ${formatter.format(now)}\n**ISO 8601:** ${now.toISOString()}\n**Unix Timestamp:** ${Math.floor(now.getTime() / 1000)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting time: ${error instanceof Error ? error.message : "Unknown error"}. Using UTC: ${new Date().toISOString()}`,
          },
        ],
      };
    }
  }
);

// Tool: Get Weather (using wttr.in - no API key needed)
server.tool(
  "get_weather",
  {
    location: z.string().describe("City name or location (e.g., 'London', 'New York', 'Tokyo')"),
    units: z.enum(["metric", "imperial"]).optional().describe("Temperature units (default: metric)"),
  },
  async ({ location, units = "metric" }) => {
    try {
      const unitParam = units === "imperial" ? "u" : "m";
      const response = await webClient.get(
        `https://wttr.in/${encodeURIComponent(location)}?format=j1&${unitParam}`,
        { headers: { Accept: "application/json" } }
      );
      
      const data = response.data;
      const current = data.current_condition?.[0];
      const area = data.nearest_area?.[0];
      
      if (!current) {
        throw new Error("No weather data available for this location");
      }
      
      const tempKey = units === "imperial" ? "temp_F" : "temp_C";
      const tempUnit = units === "imperial" ? "°F" : "°C";
      
      return {
        content: [
          {
            type: "text",
            text: `## Weather for ${area?.areaName?.[0]?.value || location}, ${area?.country?.[0]?.value || ""}\n\n**Current Conditions:**\n- Temperature: ${current[tempKey]}${tempUnit}\n- Feels Like: ${current[`FeelsLike${units === "imperial" ? "F" : "C"}`]}${tempUnit}\n- Weather: ${current.weatherDesc?.[0]?.value || "N/A"}\n- Humidity: ${current.humidity}%\n- Wind: ${current.windspeedKmph} km/h ${current.winddir16Point}\n- UV Index: ${current.uvIndex}\n- Visibility: ${current.visibility} km\n\n**Last Updated:** ${current.observation_time || "Now"}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting weather for "${location}": ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Get News Headlines
server.tool(
  "get_news",
  {
    topic: z.string().optional().describe("Topic to search news for (optional, returns general headlines if not provided)"),
    max_results: z.number().min(1).max(20).optional().describe("Maximum number of results (default: 10)"),
  },
  async ({ topic, max_results = 10 }) => {
    try {
      const results: Array<{ title: string; url: string; source: string; date?: string }> = [];
      
      // Use Hacker News for tech news
      try {
        const endpoint = topic 
          ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=${max_results}`
          : `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${max_results}`;
        
        const hnResponse = await webClient.get(endpoint);
        
        for (const hit of hnResponse.data.hits || []) {
          results.push({
            title: hit.title || "Untitled",
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            source: "Hacker News",
            date: hit.created_at ? new Date(hit.created_at).toLocaleDateString() : undefined,
          });
        }
      } catch (e) {
        console.error("Hacker News error:", e);
      }
      
      // Try Wikipedia's "In the news" for current events
      if (results.length < max_results) {
        try {
          const today = new Date();
          const wikiDate = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
          const wikiResponse = await webClient.get(
            `https://en.wikipedia.org/api/rest_v1/feed/featured/${wikiDate}`
          );
          
          if (wikiResponse.data.news) {
            for (const news of wikiResponse.data.news.slice(0, 5)) {
              if (news.story) {
                results.push({
                  title: news.story.replace(/<[^>]+>/g, ""),
                  url: news.links?.[0]?.content_urls?.desktop?.page || "",
                  source: "Wikipedia Current Events",
                  date: today.toLocaleDateString(),
                });
              }
            }
          }
        } catch (e) {
          // Ignore Wikipedia errors
        }
      }
      
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: topic 
                ? `No news found for topic: "${topic}". Try a different topic.`
                : "Unable to fetch current news. Please try again later.",
            },
          ],
        };
      }
      
      const formattedNews = results.slice(0, max_results).map((r, i) =>
        `${i + 1}. **${r.title}**\n   Source: ${r.source}${r.date ? ` | ${r.date}` : ""}\n   ${r.url}`
      ).join("\n\n");
      
      return {
        content: [
          {
            type: "text",
            text: `## ${topic ? `News: "${topic}"` : "Latest News"}\n\n${formattedNews}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching news: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Currency Exchange Rates
server.tool(
  "get_exchange_rate",
  {
    from_currency: z.string().length(3).describe("Source currency code (e.g., 'USD', 'EUR')"),
    to_currency: z.string().length(3).describe("Target currency code (e.g., 'EUR', 'JPY')"),
    amount: z.number().positive().optional().describe("Amount to convert (default: 1)"),
  },
  async ({ from_currency, to_currency, amount = 1 }) => {
    try {
      const response = await webClient.get(
        `https://api.exchangerate-api.com/v4/latest/${from_currency.toUpperCase()}`
      );
      
      const rate = response.data.rates?.[to_currency.toUpperCase()];
      
      if (!rate) {
        throw new Error(`Exchange rate not found for ${to_currency.toUpperCase()}`);
      }
      
      const converted = amount * rate;
      
      return {
        content: [
          {
            type: "text",
            text: `## Currency Exchange\n\n**${amount} ${from_currency.toUpperCase()}** = **${converted.toFixed(4)} ${to_currency.toUpperCase()}**\n\nExchange Rate: 1 ${from_currency.toUpperCase()} = ${rate.toFixed(6)} ${to_currency.toUpperCase()}\n\nLast Updated: ${response.data.date || new Date().toLocaleDateString()}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting exchange rate: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Web Search MCP server running on stdio");
