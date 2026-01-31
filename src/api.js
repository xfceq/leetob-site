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

export default {
  streamChatCompletion,
  chatCompletion,
  generateImage,
  TEXT_MODELS,
  IMAGE_MODELS,
  getApiKey,
};
