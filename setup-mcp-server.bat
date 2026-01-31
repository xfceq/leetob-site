@echo off
echo ==========================================
echo  MCP Web Search Server Setup
echo ==========================================
echo.

cd /d "%~dp0mcp-web-search-server"

echo Installing dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to install dependencies.
    echo Please ensure Node.js is installed and try again.
    pause
    exit /b 1
)

echo.
echo Building TypeScript...
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to build the server.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo  Setup Complete!
echo ==========================================
echo.
echo The MCP server has been built successfully.
echo.
echo To use with Roo Code:
echo 1. Restart VS Code to load the new MCP server
echo 2. The AI assistant will now have access to web search tools
echo.
echo Available tools:
echo   - web_search: Search the web
echo   - fetch_url: Get content from URLs
echo   - get_weather: Get weather information
echo   - get_news: Get latest news
echo   - get_current_time: Get current time
echo   - get_exchange_rate: Currency conversion
echo.
pause
