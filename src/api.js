// API Configuration
const API_BASE_URL = 'https://open.anycorp.dev/v1';
const DEFAULT_API_KEY = 'sk-public';

// Text Models with friendly names
export const TEXT_MODELS = {
  'claude-haiku-4.5': 'Claude Haiku 4.5',
  'claude-opus-4.5': 'Claude Opus 4.5',
  'claude-opus-4.5-thinking': 'Claude Opus 4.5 Thinking',
  'claude-sonnet-4': 'Claude Sonnet 4',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'claude-sonnet-4.5-thinking': 'Claude Sonnet 4.5 Thinking',
  'gemini-2.5-computer-use-preview': 'Gemini 2.5 Computer Use',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
  'gemini-3-pro-preview': 'Gemini 3 Pro Preview',
};

// Image Models with friendly names
export const IMAGE_MODELS = {
  'gemini-3-pro-image-preview': 'Gemini 3 Pro Image',
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
};

// Get API key from settings or use default
export const getApiKey = (customKey) => {
  return customKey || DEFAULT_API_KEY;
};

// Stream chat completion
export async function* streamChatCompletion(messages, options = {}) {
  const {
    model = 'gemini-2.5-flash',
    apiKey = DEFAULT_API_KEY,
    systemPrompt = 'You are a helpful assistant.',
    temperature = 0.7,
    agentMode = false,
    forceNonStreaming = false,
  } = options;

  // For thinking models and Gemini 3 models, use non-streaming to avoid content truncation
  // The streaming API from open.anycorp.dev can truncate the beginning of responses for these models
  const modelLower = model.toLowerCase();
  const isThinkingModel = modelLower.includes('thinking');
  // Gemini 3 models have streaming issues that cause first chunk content loss
  const isGemini3Model = modelLower.includes('gemini-3');
  const needsNonStreaming = isThinkingModel || isGemini3Model;
  const useStreaming = !forceNonStreaming && !needsNonStreaming;
  
  if (needsNonStreaming) {
    console.log('Model requires non-streaming mode to avoid content truncation:', model);
  }

  // Build system message
  let finalSystemPrompt = systemPrompt;
  if (agentMode) {
    finalSystemPrompt += '\n\nWhen creating apps, provide the full code for every file including filename comments (e.g., ### filename.ext or ```language:filename.ext) so I can save them. Always include complete file contents.';
  }

  const requestMessages = [
    { role: 'system', content: finalSystemPrompt },
    ...messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
  ];

  const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: requestMessages,
      temperature,
      stream: useStreaming,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(error.error?.message || `API Error: ${response.status}`);
  }

  // Handle non-streaming response for thinking models
  if (!useStreaming) {
    console.log('Using non-streaming mode for thinking model');
    const data = await response.json();
    console.log('Non-streaming response:', JSON.stringify(data, null, 2).substring(0, 500));
    
    const content = data.choices?.[0]?.message?.content || '';
    if (content) {
      yield content;
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;
  let totalContentReceived = '';
  let isFirstDataReceived = false;

  console.log('Starting stream read...');

  // Helper function to extract content from parsed JSON
  const extractContent = (json) => {
    let content = '';
    
    // Check for reasoning_content (thinking models)
    if (json.choices?.[0]?.delta?.reasoning_content) {
      console.log('Reasoning:', json.choices[0].delta.reasoning_content.substring(0, 100));
    }
    
    // Standard OpenAI/Claude format
    if (json.choices?.[0]?.delta?.content) {
      content = json.choices[0].delta.content;
    }
    // Alternative delta format
    else if (json.choices?.[0]?.delta?.text) {
      content = json.choices[0].delta.text;
    }
    // Full message in choice
    else if (json.choices?.[0]?.message?.content) {
      content = json.choices[0].message.content;
    }
    // Direct text in choice
    else if (json.choices?.[0]?.text) {
      content = json.choices[0].text;
    }
    // Candidates format (native Gemini format)
    else if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
      content = json.candidates[0].content.parts[0].text;
    }
    // Direct content in response
    else if (json.content) {
      content = json.content;
    }
    // Text directly in response
    else if (json.text) {
      content = json.text;
    }
    
    return content || null;
  };

  // Helper function to process a single SSE line
  // Returns: { content: string | null, incomplete: boolean }
  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'data: [DONE]') return { content: null, incomplete: false };
    if (!trimmed.startsWith('data: ')) return { content: null, incomplete: false };

    try {
      const jsonStr = trimmed.slice(6);
      const json = JSON.parse(jsonStr);
      
      chunkCount++;
      console.log(`Chunk #${chunkCount}:`, JSON.stringify(json, null, 2).substring(0, 300));
      
      const content = extractContent(json);
      return { content, incomplete: false };
    } catch (e) {
      // JSON parse error - this line is incomplete, need to buffer it
      console.log('JSON parse error, line incomplete, buffering:', trimmed.substring(0, 80));
      return { content: null, incomplete: true };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    
    if (done) {
      // Finalize decoder and process remaining buffer
      const remaining = decoder.decode();
      if (remaining) {
        buffer += remaining;
      }
      console.log('Stream ended. Total chunks processed:', chunkCount);
      console.log('FULL CONTENT:', totalContentReceived.substring(0, 500));
      break;
    }

    // Decode the chunk with stream: true to handle multi-byte characters correctly
    const rawChunk = decoder.decode(value, { stream: true });
    console.log('Raw data:', rawChunk.substring(0, 150));
    
    buffer += rawChunk;
    
    // Process complete SSE events from the buffer
    // SSE events are separated by \n\n or just \n depending on server
    // We need to find complete "data: {...}\n" patterns
    
    let processedUpTo = 0;
    let searchStart = 0;
    
    while (true) {
      // Find the next newline in the buffer starting from searchStart
      const newlineIndex = buffer.indexOf('\n', searchStart);
      
      if (newlineIndex === -1) {
        // No complete line found, keep everything from processedUpTo in buffer
        break;
      }
      
      // Extract the line (from processedUpTo to newlineIndex)
      const line = buffer.substring(processedUpTo, newlineIndex);
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) {
        processedUpTo = newlineIndex + 1;
        searchStart = processedUpTo;
        continue;
      }
      
      // Try to process this line
      const result = processLine(line);
      
      if (result.incomplete) {
        // This line has incomplete JSON - it might be split across chunks
        // Keep searching for more newlines in case the JSON continues
        // But don't advance processedUpTo - keep this line in buffer
        searchStart = newlineIndex + 1;
        
        // If we've searched the entire buffer, stop
        if (searchStart >= buffer.length) {
          break;
        }
        continue;
      }
      
      // Line was successfully processed (or was empty/[DONE])
      if (result.content) {
        totalContentReceived += result.content;
        if (!isFirstDataReceived) {
          isFirstDataReceived = true;
          console.log('FIRST CONTENT:', result.content);
        }
        yield result.content;
      }
      
      // Move past this line
      processedUpTo = newlineIndex + 1;
      searchStart = processedUpTo;
    }
    
    // Keep only the unprocessed part of the buffer
    if (processedUpTo > 0) {
      buffer = buffer.substring(processedUpTo);
    }
  }

  // Process any remaining data in the buffer after stream ends
  if (buffer.trim()) {
    const remainingLines = buffer.split('\n');
    for (const line of remainingLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;

      try {
        const jsonStr = trimmed.slice(6);
        const json = JSON.parse(jsonStr);
        const content = extractContent(json);
        
        if (content) {
          yield content;
        }
      } catch (e) {
        // Skip malformed JSON at the end
        console.log('Final buffer parse error, skipping:', trimmed.substring(0, 50));
      }
    }
  }
}

// Non-streaming chat completion
export async function chatCompletion(messages, options = {}) {
  const {
    model = 'gemini-2.5-flash',
    apiKey = DEFAULT_API_KEY,
    systemPrompt = 'You are a helpful assistant.',
    temperature = 0.7,
    agentMode = false,
  } = options;

  let finalSystemPrompt = systemPrompt;
  if (agentMode) {
    finalSystemPrompt += '\n\nWhen creating apps, provide the full code for every file including filename comments (e.g., ### filename.ext or ```language:filename.ext) so I can save them. Always include complete file contents.';
  }

  const requestMessages = [
    { role: 'system', content: finalSystemPrompt },
    ...messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
  ];

  const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: requestMessages,
      temperature,
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(error.error?.message || `API Error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// Generate image
export async function generateImage(prompt, options = {}) {
  const {
    model = 'gemini-2.5-flash-image',
    apiKey = DEFAULT_API_KEY,
  } = options;

  try {
    const response = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: `Generate an image: ${prompt}`,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(error.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Image API response:', JSON.stringify(data, null, 2));
    
    // Helper function to extract image from parts
    const extractFromParts = (parts) => {
      if (!Array.isArray(parts)) return null;
      for (const part of parts) {
        // Gemini inline_data format
        if (part.inline_data?.data) {
          const mimeType = part.inline_data.mime_type || 'image/png';
          const base64Data = part.inline_data.data;
          return { type: 'base64', data: `data:${mimeType};base64,${base64Data}` };
        }
        // Check for image in part
        if (part.image?.data) {
          return { type: 'base64', data: `data:image/png;base64,${part.image.data}` };
        }
      }
      return null;
    };

    // Helper to extract from data:image URL
    const extractFromDataUrl = (url) => {
      if (!url) return null;
      if (url.startsWith('data:image')) {
        return { type: 'base64', data: url };
      }
      if (url.startsWith('http')) {
        return { type: 'url', data: url };
      }
      return null;
    };

    // 1. Check OpenAI-style choices format with images array (like in Leetob.py)
    const choice = data.choices?.[0];
    const message = choice?.message;
    
    // Check for images array in message (used by open.anycorp.dev)
    if (message?.images && Array.isArray(message.images)) {
      for (const img of message.images) {
        if (img.type === 'image_url' && img.image_url?.url) {
          const result = extractFromDataUrl(img.image_url.url);
          if (result) return result;
        }
      }
    }

    // 2. Check Gemini candidates format
    if (data.candidates) {
      for (const candidate of data.candidates) {
        // Check content.parts
        if (candidate.content?.parts) {
          const result = extractFromParts(candidate.content.parts);
          if (result) return result;
        }
        // Direct parts
        if (candidate.parts) {
          const result = extractFromParts(candidate.parts);
          if (result) return result;
        }
      }
    }

    const content = message?.content;
    
    // Check for parts in message (Gemini via OpenAI wrapper)
    if (message?.parts) {
      const result = extractFromParts(message.parts);
      if (result) return result;
    }

    // 3. Check content array format (multimodal responses)
    if (Array.isArray(content)) {
      for (const item of content) {
        // OpenAI vision format
        if (item.type === 'image' && item.image_url?.url) {
          const result = extractFromDataUrl(item.image_url.url);
          if (result) return result;
        }
        if (item.type === 'image_url' && item.image_url?.url) {
          const result = extractFromDataUrl(item.image_url.url);
          if (result) return result;
        }
        // Gemini format in array
        if (item.inline_data?.data) {
          const mimeType = item.inline_data.mime_type || 'image/png';
          return { type: 'base64', data: `data:${mimeType};base64,${item.inline_data.data}` };
        }
        // Text part with image
        if (item.type === 'text' && item.text) {
          const base64Match = item.text.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
          if (base64Match) {
            return { type: 'base64', data: base64Match[0] };
          }
        }
      }
    }
    
    // 4. Parse string content
    if (typeof content === 'string' && content) {
      // Check if it's a base64 image with data URI
      const base64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
      if (base64Match) {
        return { type: 'base64', data: base64Match[0] };
      }
      
      // Check if it's a URL
      const urlMatch = content.match(/https?:\/\/[^\s"<>]+/i);
      if (urlMatch) {
        const url = urlMatch[0];
        if (/\.(png|jpg|jpeg|gif|webp|svg)/i.test(url) || url.includes('image')) {
          return { type: 'url', data: url };
        }
      }

      // Check for markdown image syntax
      const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (mdMatch) {
        return { type: 'url', data: mdMatch[1] };
      }

      // Return raw content if it might be base64 without prefix
      const cleanContent = content.replace(/\s/g, '');
      if (cleanContent.length > 100 && /^[A-Za-z0-9+/=]+$/.test(cleanContent)) {
        return { type: 'base64', data: `data:image/png;base64,${cleanContent}` };
      }
      
      // Return text content for debugging
      return { type: 'text', data: content };
    }

    // 5. Check if there's a direct image field
    if (data.image) {
      const result = extractFromDataUrl(data.image);
      if (result) return result;
      // Raw base64 without prefix
      if (typeof data.image === 'string') {
        return { type: 'base64', data: `data:image/png;base64,${data.image}` };
      }
    }

    // If parsing fails, return error message with raw response for debugging
    console.error('Could not parse image from response. Raw data keys:', Object.keys(data));
    if (message) {
      console.error('Message keys:', Object.keys(message));
    }
    return { type: 'text', data: 'No image generated. The model may not support image generation or the response format is unsupported. Check console for details.' };
  } catch (error) {
    console.error('Image generation error:', error);
    return { type: 'text', data: `Error generating image: ${error.message}` };
  }
}

// URL detection regex
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// Extract URLs from text
export function extractUrls(text) {
  const matches = text.match(URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

// Fetch URL content via CORS proxy
export async function fetchUrlContent(url) {
  // List of CORS proxy services to try
  const corsProxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  for (const getProxyUrl of corsProxies) {
    try {
      const proxyUrl = getProxyUrl(url);
      console.log('Fetching via proxy:', proxyUrl);
      
      const response = await fetch(proxyUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      
      if (!response.ok) {
        console.log(`Proxy failed with status ${response.status}, trying next...`);
        continue;
      }
      
      const html = await response.text();
      
      // Extract meaningful content from HTML
      const content = extractTextFromHtml(html, url);
      return {
        success: true,
        url,
        content,
        title: extractTitle(html),
      };
    } catch (error) {
      console.log('Proxy error:', error.message);
      continue;
    }
  }
  
  return {
    success: false,
    url,
    error: 'Failed to fetch URL content through available proxies',
  };
}

// Extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : '';
}

// Extract readable text from HTML
function extractTextFromHtml(html, url) {
  // Remove script and style tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  
  // Extract meta description
  const metaDescMatch = text.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                        text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  const metaDesc = metaDescMatch ? metaDescMatch[1] : '';
  
  // Extract main content areas
  const mainContentPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class=["'][^"']*post[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
  ];
  
  let mainContent = '';
  for (const pattern of mainContentPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      mainContent += match[1] + '\n';
    }
  }
  
  // If no main content found, use body
  if (!mainContent) {
    const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    mainContent = bodyMatch ? bodyMatch[1] : text;
  }
  
  // Remove remaining HTML tags
  mainContent = mainContent
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  
  // Limit content length
  const maxLength = 8000;
  if (mainContent.length > maxLength) {
    mainContent = mainContent.substring(0, maxLength) + '...';
  }
  
  return metaDesc ? `${metaDesc}\n\n${mainContent}` : mainContent;
}

// Perform real web search using multiple sources - ENHANCED VERSION
export async function performWebSearch(query) {
  console.log('🔍 Starting enhanced web search for:', query);
  const allResults = [];
  
  // CORS proxies for accessing search engines
  const corsProxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
  ];
  
  // Helper to fetch with multiple proxies
  async function fetchWithProxies(url, timeoutMs = 10000) {
    for (const getProxyUrl of corsProxies) {
      try {
        const proxyUrl = getProxyUrl(url);
        console.log('Trying proxy:', proxyUrl.substring(0, 80));
        const response = await fetch(proxyUrl, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
          }
        });
        if (response.ok) {
          return await response.text();
        }
      } catch (e) {
        console.log('Proxy failed:', e.message);
        continue;
      }
    }
    return null;
  }
  
  // SOURCE 1: DuckDuckGo HTML Search (PRIMARY - gives actual search results)
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchWithProxies(searchUrl);
    
    if (html) {
      const scrapedResults = parseSearchResults(html);
      console.log(`📄 DuckDuckGo HTML: found ${scrapedResults.length} results`);
      
      for (const result of scrapedResults) {
        if (!allResults.some(r => r.url === result.url)) {
          allResults.push(result);
        }
      }
    }
  } catch (error) {
    console.log('DuckDuckGo HTML error:', error.message);
  }
  
  // SOURCE 2: DuckDuckGo Instant Answer API (for quick answers)
  try {
    const ddgApiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(ddgApiUrl, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json();
      
      if (data.Abstract && data.Abstract.length > 30) {
        allResults.unshift({
          title: data.Heading || 'Quick Answer',
          snippet: data.Abstract,
          url: data.AbstractURL || '',
          source: data.AbstractSource || 'DuckDuckGo'
        });
      }
      
      if (data.Answer) {
        allResults.unshift({
          title: 'Direct Answer',
          snippet: data.Answer,
          url: '',
          source: 'DuckDuckGo'
        });
      }
      
      // Related topics
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 3)) {
          if (topic.Text && !allResults.some(r => r.snippet === topic.Text)) {
            allResults.push({
              title: topic.FirstURL ? new URL(topic.FirstURL).hostname : 'Related',
              snippet: topic.Text,
              url: topic.FirstURL || '',
              source: 'DuckDuckGo'
            });
          }
        }
      }
    }
  } catch (error) {
    console.log('DuckDuckGo API error:', error.message);
  }
  
  // SOURCE 3: Wikipedia (for encyclopedic info)
  try {
    // Try Wikipedia search first
    const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3`;
    const wikiSearchResponse = await fetch(wikiSearchUrl, { signal: AbortSignal.timeout(5000) });
    
    if (wikiSearchResponse.ok) {
      const wikiData = await wikiSearchResponse.json();
      const searchResults = wikiData.query?.search || [];
      
      for (const result of searchResults) {
        const snippet = result.snippet?.replace(/<[^>]+>/g, '') || '';
        if (snippet && !allResults.some(r => r.title === result.title)) {
          allResults.push({
            title: result.title,
            snippet: snippet,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`,
            source: 'Wikipedia'
          });
        }
      }
    }
  } catch (error) {
    console.log('Wikipedia search error:', error.message);
  }
  
  // SOURCE 4: Russian Wikipedia (for Russian queries)
  const hasRussian = /[а-яё]/i.test(query);
  if (hasRussian) {
    try {
      const ruWikiUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3`;
      const ruWikiResponse = await fetch(ruWikiUrl, { signal: AbortSignal.timeout(5000) });
      
      if (ruWikiResponse.ok) {
        const ruWikiData = await ruWikiResponse.json();
        const results = ruWikiData.query?.search || [];
        
        for (const result of results) {
          const snippet = result.snippet?.replace(/<[^>]+>/g, '') || '';
          if (snippet && !allResults.some(r => r.title === result.title)) {
            allResults.push({
              title: result.title,
              snippet: snippet,
              url: `https://ru.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`,
              source: 'Википедия'
            });
          }
        }
      }
    } catch (error) {
      console.log('Russian Wikipedia error:', error.message);
    }
  }
  
  // SOURCE 5: Hacker News (for any query - great for recent info)
  try {
    const hnSearchUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
    const hnResponse = await fetch(hnSearchUrl, { signal: AbortSignal.timeout(5000) });
    
    if (hnResponse.ok) {
      const hnData = await hnResponse.json();
      for (const hit of (hnData.hits || []).slice(0, 5)) {
        if (hit.title && !allResults.some(r => r.title === hit.title)) {
          allResults.push({
            title: hit.title,
            snippet: `${hit.points || 0} points | ${hit.num_comments || 0} comments | by ${hit.author || 'unknown'} | ${new Date(hit.created_at).toLocaleDateString()}`,
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            source: 'Hacker News'
          });
        }
      }
    }
  } catch (error) {
    console.log('HN API error:', error.message);
  }
  
  // SOURCE 6: Stack Overflow (for programming queries)
  const progKeywords = ['code', 'error', 'function', 'how to', 'tutorial', 'example', 'javascript', 'python', 'react', 'typescript', 'css', 'html', 'api', 'программирование', 'ошибка', 'код'];
  const isProgrammingQuery = progKeywords.some(kw => query.toLowerCase().includes(kw));
  
  if (isProgrammingQuery) {
    try {
      const soUrl = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=3&filter=!nNPvSNdWme`;
      const soResponse = await fetch(soUrl, { signal: AbortSignal.timeout(5000) });
      
      if (soResponse.ok) {
        const soData = await soResponse.json();
        for (const item of (soData.items || []).slice(0, 3)) {
          if (item.title && !allResults.some(r => r.url === item.link)) {
            allResults.push({
              title: item.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
              snippet: `Score: ${item.score} | Answers: ${item.answer_count} | Views: ${item.view_count}`,
              url: item.link,
              source: 'Stack Overflow'
            });
          }
        }
      }
    } catch (error) {
      console.log('Stack Overflow error:', error.message);
    }
  }
  
  // SOURCE 7: Reddit Search (via old.reddit.com for better scraping)
  try {
    const redditUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=3&sort=relevance`;
    const redditResponse = await fetch(redditUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (redditResponse.ok) {
      const redditData = await redditResponse.json();
      for (const post of (redditData.data?.children || []).slice(0, 3)) {
        const d = post.data;
        if (d.title && !allResults.some(r => r.url === `https://reddit.com${d.permalink}`)) {
          allResults.push({
            title: d.title,
            snippet: `r/${d.subreddit} | ${d.score} upvotes | ${d.num_comments} comments`,
            url: `https://reddit.com${d.permalink}`,
            source: 'Reddit'
          });
        }
      }
    }
  } catch (error) {
    console.log('Reddit error:', error.message);
  }
  
  console.log(`🔍 Total search results: ${allResults.length}`);
  
  if (allResults.length > 0) {
    return { success: true, results: allResults.slice(0, 15), source: 'multi-source' };
  }
  
  return { success: false, results: [], error: 'Search failed - no results from any source' };
}

// Enhanced HTML parser for DuckDuckGo results
function parseSearchResults(html) {
  const results = [];
  
  // Method 1: Parse result divs
  const resultBlocks = html.split(/class="result\s/i);
  
  for (let i = 1; i < resultBlocks.length && results.length < 10; i++) {
    const block = resultBlocks[i];
    
    // Extract URL
    let url = '';
    const urlMatch = block.match(/href="([^"]*uddg[^"]*)"/i) ||
                     block.match(/href="(https?:\/\/[^"]+)"/i);
    if (urlMatch) {
      url = urlMatch[1];
      // Decode DuckDuckGo redirect URL
      if (url.includes('uddg=')) {
        const decoded = decodeURIComponent(url.split('uddg=')[1]?.split('&')[0] || '');
        if (decoded) url = decoded;
      }
    }
    
    // Extract title
    let title = '';
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</i) ||
                       block.match(/<a[^>]*>([^<]{10,})</i);
    if (titleMatch) {
      title = titleMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
    }
    
    // Extract snippet
    let snippet = '';
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]+)</i) ||
                         block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    if (snippetMatch) {
      snippet = snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
    }
    
    if (title && url && url.startsWith('http')) {
      results.push({
        title,
        snippet: snippet || 'No description available',
        url,
        source: 'Web'
      });
    }
  }
  
  // Method 2: Regex fallback if method 1 didn't work well
  if (results.length < 3) {
    // Try to extract links with snippets
    const linkPattern = /href="[^"]*uddg=([^"&]+)[^"]*"[^>]*>([^<]+)<[\s\S]*?class="result__snippet"[^>]*>([^<]+)</gi;
    let match;
    
    while ((match = linkPattern.exec(html)) !== null && results.length < 10) {
      try {
        const url = decodeURIComponent(match[1]);
        const title = match[2].replace(/&amp;/g, '&').trim();
        const snippet = match[3].replace(/&amp;/g, '&').trim();
        
        if (url.startsWith('http') && !results.some(r => r.url === url)) {
          results.push({ title, snippet, url, source: 'Web' });
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return results;
}

// OLD Parse search results function for reference
function parseSearchResultsLegacy(html) {
  const results = [];
  
  const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;
  
  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < 8) {
    results.push({
      url: match[1],
      title: match[2].replace(/<[^>]+>/g, '').trim(),
      snippet: match[3].replace(/<[^>]+>/g, '').trim(),
      source: 'Web'
    });
  }
  
  // Alternative parsing if the above doesn't work
  if (results.length === 0) {
    const altPattern = /class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    while ((match = altPattern.exec(html)) !== null && results.length < 8) {
      results.push({
        url: match[1],
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        snippet: '',
        source: 'Web'
      });
    }
  }
  
  return results;
}

// Perform web search via AI with grounding
export async function* streamWebSearchCompletion(query, urls, options = {}) {
  const {
    model = 'gemini-2.5-flash',
    apiKey = DEFAULT_API_KEY,
    systemPrompt = 'You are a helpful assistant.',
    temperature = 0.7,
    previousMessages = [],
    userTimezone = 'Asia/Yakutsk',
  } = options;

  let webContext = '';
  let directAnswer = null;
  
  // First, detect query intent for special handling
  const intent = detectQueryIntent(query);
  console.log('Detected intent:', intent, 'for query:', query);
  
  // Handle special intents with direct answers
  if (intent === 'time') {
    const timeData = getCurrentDateTime(userTimezone);
    webContext += '\n=== ТЕКУЩАЯ ДАТА И ВРЕМЯ ===\n';
    webContext += `Дата и время: ${timeData.formatted}\n`;
    webContext += `ISO формат: ${timeData.iso}\n`;
    webContext += `Часовой пояс: ${timeData.timezone}\n`;
    webContext += `Unix timestamp: ${timeData.timestamp}\n`;
    webContext += '=== КОНЕЦ ===\n';
    directAnswer = `Сейчас: ${timeData.formatted}`;
  }
  
  if (intent === 'weather') {
    // Extract location from query
    const locationMatch = query.match(/(?:погода\s+(?:в|во?)\s+|weather\s+(?:in|for)\s+)([а-яёa-z\s-]+)/i);
    const location = locationMatch ? locationMatch[1].trim() : 'Якутск';
    
    const weatherData = await getWeather(location);
    if (weatherData.success) {
      webContext += '\n=== ТЕКУЩАЯ ПОГОДА ===\n';
      webContext += `Местоположение: ${weatherData.location}\n`;
      webContext += `Температура: ${weatherData.temperature} (ощущается как ${weatherData.feelsLike})\n`;
      webContext += `Погода: ${weatherData.description}\n`;
      webContext += `Влажность: ${weatherData.humidity}\n`;
      webContext += `Ветер: ${weatherData.wind}\n`;
      webContext += `UV индекс: ${weatherData.uvIndex}\n`;
      webContext += `Видимость: ${weatherData.visibility}\n`;
      webContext += '=== КОНЕЦ ===\n';
    }
  }
  
  if (intent === 'currency') {
    // Try to extract currency pairs and amount
    const amountMatch = query.match(/(\d+(?:[.,]\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '.')) : 1;
    
    // Detect currencies
    let from = 'USD', to = 'RUB';
    if (/евро|eur/i.test(query)) from = 'EUR';
    if (/доллар|usd|\$/i.test(query)) from = 'USD';
    if (/рубл|rub|₽/i.test(query)) to = 'RUB';
    if (/в\s*евро|to\s*eur/i.test(query)) to = 'EUR';
    if (/в\s*доллар|to\s*usd/i.test(query)) to = 'USD';
    
    const exchangeData = await getExchangeRate(from, to, amount);
    if (exchangeData.success) {
      webContext += '\n=== КУРС ВАЛЮТ ===\n';
      webContext += `${exchangeData.amount} ${exchangeData.from} = ${exchangeData.result} ${exchangeData.to}\n`;
      webContext += `Курс: 1 ${exchangeData.from} = ${exchangeData.rate.toFixed(4)} ${exchangeData.to}\n`;
      webContext += `Обновлено: ${exchangeData.lastUpdated}\n`;
      webContext += '=== КОНЕЦ ===\n';
    }
  }
  
  if (intent === 'news') {
    const topicMatch = query.match(/новост[иья]\s+(?:про|о|об)\s+(.+)/i) ||
                       query.match(/news\s+(?:about|on)\s+(.+)/i);
    const topic = topicMatch ? topicMatch[1].trim() : null;
    
    const newsData = await getNewsHeadlines(topic, 5);
    if (newsData.success && newsData.results.length > 0) {
      webContext += `\n=== ПОСЛЕДНИЕ НОВОСТИ${topic ? `: ${topic}` : ''} ===\n`;
      for (const news of newsData.results) {
        webContext += `\n📰 ${news.title}\n`;
        if (news.source) webContext += `   Источник: ${news.source}\n`;
        if (news.url) webContext += `   URL: ${news.url}\n`;
        if (news.date) webContext += `   Дата: ${news.date}\n`;
      }
      webContext += '=== КОНЕЦ НОВОСТЕЙ ===\n';
    }
  }
  
  // Perform real web search if no URLs provided and intent is general search
  if ((!urls || urls.length === 0) && (intent === 'search' || !webContext)) {
    console.log('Performing web search for:', query);
    const searchResult = await performWebSearch(query);
    
    if (searchResult.success && searchResult.results.length > 0) {
      webContext += '\n=== WEB SEARCH RESULTS ===\n';
      for (const result of searchResult.results) {
        webContext += `\nTitle: ${result.title}\n`;
        if (result.url) webContext += `URL: ${result.url}\n`;
        if (result.snippet) webContext += `Summary: ${result.snippet}\n`;
        webContext += '---\n';
      }
      webContext += '=== END OF SEARCH RESULTS ===\n';
      
      // Optionally fetch full content from top result URLs
      const topUrls = searchResult.results
        .filter(r => r.url && r.url.startsWith('http'))
        .slice(0, 2)
        .map(r => r.url);
      
      for (const url of topUrls) {
        try {
          const content = await fetchUrlContent(url);
          if (content.success) {
            webContext += `\n--- Full content from: ${url} ---\n`;
            if (content.title) webContext += `Page Title: ${content.title}\n`;
            webContext += content.content.substring(0, 3000);
            webContext += '\n---\n';
          }
        } catch (e) {
          console.log('Failed to fetch URL content:', e.message);
        }
      }
    }
  }
  
  // Fetch content from provided URLs
  if (urls && urls.length > 0) {
    console.log('Fetching content from URLs:', urls);
    
    for (const url of urls.slice(0, 3)) {
      const result = await fetchUrlContent(url);
      if (result.success) {
        webContext += `\n--- Content from: ${url} ---\n`;
        if (result.title) webContext += `Title: ${result.title}\n`;
        webContext += result.content;
        webContext += '\n---\n';
      } else {
        webContext += `\n--- Could not fetch: ${url} ---\nError: ${result.error}\n`;
      }
    }
  }

  // Create enhanced system prompt for web search mode
  const webSearchSystemPrompt = `${systemPrompt}

You are operating with LIVE WEB SEARCH capabilities. You have access to real-time information from the internet.

INSTRUCTIONS:
1. Base your response primarily on the web search results and fetched content provided below
2. Cite sources with their URLs when referencing specific information
3. If the search results don't fully answer the question, acknowledge this and provide what information is available
4. Synthesize information from multiple sources when relevant
5. Format your response clearly with the most relevant information first

${webContext ? webContext : 'No web results available for this query.'}`;

  // Build messages
  const messages = [
    ...previousMessages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: query },
  ];

  // Stream the completion
  for await (const chunk of streamChatCompletion(messages, {
    model,
    apiKey,
    systemPrompt: webSearchSystemPrompt,
    temperature,
  })) {
    yield chunk;
  }
}

// Check if message contains URLs and should trigger auto-analysis
export function shouldAutoAnalyzeUrls(message) {
  const urls = extractUrls(message);
  return urls.length > 0;
}

// Build web search context message
export function buildWebSearchContext(query, urlContents) {
  let context = '';
  
  if (urlContents && urlContents.length > 0) {
    context = 'I found the following content from the URLs you shared:\n\n';
    for (const content of urlContents) {
      context += `**${content.title || content.url}**\n`;
      context += `Source: ${content.url}\n`;
      context += `${content.content.substring(0, 500)}...\n\n`;
    }
  }
  
  return context;
}

// ============================================
// REAL-TIME INFORMATION FUNCTIONS
// ============================================

// Get current date and time
export function getCurrentDateTime(timezone = 'UTC') {
  const now = new Date();
  
  try {
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
    
    return {
      formatted: formatter.format(now),
      iso: now.toISOString(),
      timestamp: Math.floor(now.getTime() / 1000),
      timezone,
    };
  } catch (e) {
    // Fallback if timezone is invalid
    return {
      formatted: now.toLocaleString('ru-RU'),
      iso: now.toISOString(),
      timestamp: Math.floor(now.getTime() / 1000),
      timezone: 'UTC',
    };
  }
}

// Get weather for a location (using wttr.in - no API key needed)
export async function getWeather(location, units = 'metric') {
  try {
    const unitParam = units === 'imperial' ? 'u' : 'm';
    const response = await fetch(
      `https://wttr.in/${encodeURIComponent(location)}?format=j1&${unitParam}`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      }
    );
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const data = await response.json();
    const current = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    
    if (!current) {
      throw new Error('No weather data available');
    }
    
    const tempKey = units === 'imperial' ? 'temp_F' : 'temp_C';
    const feelsLikeKey = units === 'imperial' ? 'FeelsLikeF' : 'FeelsLikeC';
    const tempUnit = units === 'imperial' ? '°F' : '°C';
    
    return {
      success: true,
      location: `${area?.areaName?.[0]?.value || location}, ${area?.country?.[0]?.value || ''}`,
      temperature: `${current[tempKey]}${tempUnit}`,
      feelsLike: `${current[feelsLikeKey]}${tempUnit}`,
      description: current.weatherDesc?.[0]?.value || 'N/A',
      humidity: `${current.humidity}%`,
      wind: `${current.windspeedKmph} км/ч ${current.winddir16Point}`,
      uvIndex: current.uvIndex,
      visibility: `${current.visibility} км`,
      lastUpdated: current.observation_time || 'сейчас',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Get currency exchange rate
export async function getExchangeRate(fromCurrency, toCurrency, amount = 1) {
  try {
    const response = await fetch(
      `https://api.exchangerate-api.com/v4/latest/${fromCurrency.toUpperCase()}`,
      { signal: AbortSignal.timeout(10000) }
    );
    
    if (!response.ok) {
      throw new Error(`Exchange rate API error: ${response.status}`);
    }
    
    const data = await response.json();
    const rate = data.rates?.[toCurrency.toUpperCase()];
    
    if (!rate) {
      throw new Error(`Exchange rate not found for ${toCurrency}`);
    }
    
    const converted = amount * rate;
    
    return {
      success: true,
      from: fromCurrency.toUpperCase(),
      to: toCurrency.toUpperCase(),
      amount,
      rate,
      result: converted.toFixed(4),
      lastUpdated: data.date || new Date().toLocaleDateString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Get news headlines
export async function getNewsHeadlines(topic = null, maxResults = 10) {
  const results = [];
  
  // Hacker News for tech news
  try {
    const endpoint = topic
      ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=${maxResults}`
      : `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${maxResults}`;
    
    const hnResponse = await fetch(endpoint, {
      signal: AbortSignal.timeout(8000)
    });
    
    if (hnResponse.ok) {
      const hnData = await hnResponse.json();
      for (const hit of hnData.hits || []) {
        results.push({
          title: hit.title || 'Untitled',
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source: 'Hacker News',
          points: hit.points || 0,
          comments: hit.num_comments || 0,
          date: hit.created_at ? new Date(hit.created_at).toLocaleDateString('ru-RU') : undefined,
        });
      }
    }
  } catch (e) {
    console.log('Hacker News error:', e.message);
  }
  
  // Wikipedia current events
  if (results.length < maxResults) {
    try {
      const today = new Date();
      const wikiDate = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
      const wikiResponse = await fetch(
        `https://en.wikipedia.org/api/rest_v1/feed/featured/${wikiDate}`,
        { signal: AbortSignal.timeout(8000) }
      );
      
      if (wikiResponse.ok) {
        const wikiData = await wikiResponse.json();
        if (wikiData.news) {
          for (const news of wikiData.news.slice(0, 5)) {
            if (news.story) {
              results.push({
                title: news.story.replace(/<[^>]+>/g, ''),
                url: news.links?.[0]?.content_urls?.desktop?.page || '',
                source: 'Wikipedia',
                date: today.toLocaleDateString('ru-RU'),
              });
            }
          }
        }
      }
    } catch (e) {
      console.log('Wikipedia news error:', e.message);
    }
  }
  
  return {
    success: results.length > 0,
    results,
    topic: topic || 'general',
  };
}

// Detect query intent for smart routing
export function detectQueryIntent(query) {
  const lowerQuery = query.toLowerCase();
  
  // Time/date queries
  const timePatterns = [
    /какое?\s*(сегодня\s*)?(число|дата|время|день)/i,
    /сколько\s*(сейчас\s*)?(времени|время)/i,
    /который\s+час/i,
    /what\s*(is\s*the\s*)?(time|date|day)/i,
    /current\s*(time|date)/i,
  ];
  
  // Weather queries
  const weatherPatterns = [
    /погод[аеуы]/i,
    /weather/i,
    /температур[аеуы]/i,
    /temperature/i,
    /какая\s+погода/i,
  ];
  
  // Currency queries
  const currencyPatterns = [
    /курс/i,
    /exchange\s*rate/i,
    /сколько\s+(стоит|будет).*?(доллар|евро|рубл|bitcoin|btc|eth)/i,
    /convert.*?(usd|eur|rub|btc)/i,
    /(\d+)\s*(usd|eur|rub|dollar|euro|рубл)/i,
  ];
  
  // News queries
  const newsPatterns = [
    /новост[иья]/i,
    /news/i,
    /что\s+(нового|происходит|случилось)/i,
    /п��следние\s+(события|новости)/i,
  ];
  
  if (timePatterns.some(p => p.test(lowerQuery))) {
    return 'time';
  }
  if (weatherPatterns.some(p => p.test(lowerQuery))) {
    return 'weather';
  }
  if (currencyPatterns.some(p => p.test(lowerQuery))) {
    return 'currency';
  }
  if (newsPatterns.some(p => p.test(lowerQuery))) {
    return 'news';
  }
  
  return 'search';
}

// Enhanced web search that handles special queries
export async function smartWebSearch(query) {
  const intent = detectQueryIntent(query);
  const results = {
    intent,
    data: null,
    searchResults: null,
  };
  
  // Handle special intents first
  switch (intent) {
    case 'time':
      results.data = getCurrentDateTime('Asia/Yakutsk'); // User's timezone
      break;
      
    case 'weather':
      // Try to extract location from query
      const locationMatch = query.match(/(?:погода\s+(?:в|во?)\s+|weather\s+(?:in|for)\s+)([а-яёa-z\s]+)/i);
      const location = locationMatch ? locationMatch[1].trim() : 'Moscow';
      results.data = await getWeather(location);
      break;
      
    case 'currency':
      // Try to extract currency pairs
      const currencyMatch = query.match(/(\d+)?\s*(usd|eur|rub|dollar|euro|доллар|евро|рубл)/gi);
      if (currencyMatch) {
        const from = 'USD';
        const to = 'RUB';
        const amount = parseFloat(query.match(/\d+/)?.[0] || '1');
        results.data = await getExchangeRate(from, to, amount);
      }
      break;
      
    case 'news':
      const topicMatch = query.match(/новост[иья]\s+(?:про|о|об)\s+(.+)/i) ||
                         query.match(/news\s+(?:about|on)\s+(.+)/i);
      const topic = topicMatch ? topicMatch[1].trim() : null;
      results.data = await getNewsHeadlines(topic, 5);
      break;
  }
  
  // Also perform regular web search for context
  if (intent === 'search' || !results.data?.success) {
    results.searchResults = await performWebSearch(query);
  }
  
  return results;
}

export default {
  streamChatCompletion,
  chatCompletion,
  generateImage,
  streamWebSearchCompletion,
  performWebSearch,
  fetchUrlContent,
  extractUrls,
  shouldAutoAnalyzeUrls,
  buildWebSearchContext,
  getCurrentDateTime,
  getWeather,
  getExchangeRate,
  getNewsHeadlines,
  detectQueryIntent,
  smartWebSearch,
  TEXT_MODELS,
  IMAGE_MODELS,
  getApiKey,
};
