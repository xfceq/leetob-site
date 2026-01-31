# MCP Web Search Server

An MCP (Model Context Protocol) server that provides AI assistants with full internet access capabilities including web search, URL fetching, weather, news, and real-time information.

## Features

This server provides the following tools:

### 1. `web_search`
Search the web using DuckDuckGo, Wikipedia, and Hacker News APIs.
- **query**: Search query string
- **max_results**: Maximum number of results (1-20, default: 10)

### 2. `fetch_url`
Fetch and extract content from any URL.
- **url**: The URL to fetch
- **extract_text**: Extract clean text from HTML (default: true)

### 3. `get_current_time`
Get current date and time in any timezone.
- **timezone**: Timezone name (e.g., 'America/New_York', default: UTC)

### 4. `get_weather`
Get current weather for any location using wttr.in.
- **location**: City name or location
- **units**: Temperature units ('metric' or 'imperial', default: metric)

### 5. `get_news`
Get latest news headlines from Hacker News and Wikipedia.
- **topic**: Topic to search (optional)
- **max_results**: Maximum number of results (1-20, default: 10)

### 6. `get_exchange_rate`
Get currency exchange rates.
- **from_currency**: Source currency code (e.g., 'USD')
- **to_currency**: Target currency code (e.g., 'EUR')
- **amount**: Amount to convert (default: 1)

## Installation

```bash
cd mcp-web-search-server
npm install
npm run build
```

## Usage with Roo Code

Add this server to your Roo Code MCP settings file.

### For Windows

Edit `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json`:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["c:/leetob-site/mcp-web-search-server/build/index.js"],
      "disabled": false
    }
  }
}
```

### For macOS/Linux

Edit `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/path/to/mcp-web-search-server/build/index.js"],
      "disabled": false
    }
  }
}
```

## Development

```bash
# Watch mode for development
npm run dev

# Build the server
npm run build

# Run the server directly
npm start
```

## How It Works

The server uses free, public APIs that don't require API keys:

- **DuckDuckGo**: Instant Answer API and HTML scraping
- **Wikipedia**: REST API for encyclopedic content
- **Hacker News**: Algolia Search API for tech news
- **wttr.in**: Free weather service
- **exchangerate-api.com**: Free currency exchange rates

The server includes CORS proxy fallbacks to handle websites that block direct access.

## Example Prompts

Once configured, you can ask the AI:

- "Search the web for the latest news about AI"
- "What's the weather like in Tokyo?"
- "Fetch the content from https://example.com"
- "What is the current exchange rate from USD to EUR?"
- "Get me the latest tech news from Hacker News"
- "What time is it in New York?"

## License

MIT
