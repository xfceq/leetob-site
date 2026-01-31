import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowUp,
  Menu,
  Loader2,
  Zap,
  Image,
  MessageSquare,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Wand2,
  Upload,
  RefreshCw,
  PanelLeftClose,
  X,
  Search,
} from 'lucide-react';
import useChatStore from '../store';
import { streamChatCompletion, generateImage, TEXT_MODELS, streamWebSearchCompletion, extractUrls } from '../api';
import { agentManager } from '../AgentManager';
import CodeBlock, { InlineCode } from './CodeBlock';
import { ChatImage, ImageModal } from './Gallery';

// Helper to convert file to base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Attachment preview component
function AttachmentPreview({ attachments, onRemove }) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 p-2 border-b border-white/10">
      {attachments.map((attachment, index) => (
        <div key={index} className="relative group">
          {attachment.type === 'image' ? (
            <img
              src={attachment.data}
              alt={attachment.name}
              className="w-16 h-16 object-cover rounded-lg border border-white/10"
            />
          ) : (
            <div className="w-16 h-16 flex items-center justify-center rounded-lg bg-white/5 border border-white/10">
              <span className="text-[10px] text-white/50 text-center px-1 truncate">
                {attachment.name}
              </span>
            </div>
          )}
          <button
            onClick={() => onRemove(index)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white/20 hover:bg-white/40 backdrop-blur-sm rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200"
          >
            <X className="w-3 h-3 text-white/80" />
          </button>
        </div>
      ))}
    </div>
  );
}

// AI-Powered Prompt Enhancer
const enhancePromptWithAI = async (prompt, isImageMode, apiKey, currentModel) => {
  if (!prompt.trim()) return prompt;
  
  const enhanceSystemPrompt = isImageMode 
    ? `You are a prompt engineer for image generation. Improve the given prompt by adding artistic details, lighting, style, and quality terms. Output ONLY the enhanced prompt, nothing else. Keep it concise but detailed.`
    : `You are a prompt engineer. Improve the given prompt to get better AI responses. Make it clearer, more specific, and well-structured. Output ONLY the enhanced prompt, nothing else.`;

  try {
    let enhanced = '';
    for await (const chunk of streamChatCompletion(
      [{ role: 'user', content: `Enhance this prompt: "${prompt}"` }],
      {
        model: currentModel,
        apiKey: apiKey,
        systemPrompt: enhanceSystemPrompt,
        temperature: 0.7,
      }
    )) {
      enhanced += chunk;
    }
    return enhanced.trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    console.error('Enhancement failed:', error);
    if (isImageMode) {
      return `${prompt}, highly detailed, professional quality, 8k resolution`;
    }
    return prompt;
  }
};

// Memoized markdown components to prevent recreation on each render
const createMarkdownComponents = () => ({
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const code = String(children).replace(/\n$/, '');

    if (!inline && (language || code.includes('\n'))) {
      return <CodeBlock code={code} language={language} />;
    }
    return <InlineCode {...props}>{children}</InlineCode>;
  },
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 opacity-70 hover:opacity-100">
      {children}
    </a>
  ),
});

// Message component with remake option - memoized for performance
const Message = memo(function Message({ message, isCollapsed, onToggleCollapse, onRemake, isRemaking, isStreaming, onImageClick }) {
  const isUser = message.role === 'user';
  const contentRef = useRef(null);
  const [shouldCollapse, setShouldCollapse] = useState(false);
  const [showRemakeMenu, setShowRemakeMenu] = useState(false);
  const remakeMenuRef = useRef(null);

  // Only check height when message is complete (not streaming)
  useEffect(() => {
    if (contentRef.current && !isUser && !isStreaming) {
      const height = contentRef.current.scrollHeight;
      setShouldCollapse(height > 200);
    }
  }, [message.content, isUser, isStreaming]);

  // Close remake menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (remakeMenuRef.current && !remakeMenuRef.current.contains(event.target)) {
        setShowRemakeMenu(false);
      }
    };

    if (showRemakeMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showRemakeMenu]);

  // Memoize markdown components
  const markdownComponents = useMemo(() => createMarkdownComponents(), []);

  return (
    <div className={`flex items-start gap-2 ${isUser ? 'justify-end' : 'justify-start'} group relative`}>
      
      <div
        className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'} ${
          shouldCollapse && isCollapsed ? 'thread-collapsed' : ''
        }`}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        <div ref={contentRef}>
          {message.type === 'image' && message.image ? (
            <ChatImage image={message.image} onClick={() => onImageClick(message.image)} />
          ) : (
            <div className="prose-chat">
              <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Collapse/Expand button - only show when not streaming */}
        {shouldCollapse && !isStreaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(message.id);
            }}
            className={`${isCollapsed ? 'thread-expand-btn' : 'mt-2 flex items-center gap-1 text-xs text-white/40 hover:text-white/60'}`}
          >
            {isCollapsed ? (
              <>Show more <ChevronDown className="w-3 h-3" /></>
            ) : (
              <>Show less <ChevronUp className="w-3 h-3" /></>
            )}
          </button>
        )}
      </div>


      {/* Remake button for AI messages - only show when not streaming */}
      {!isUser && onRemake && !isStreaming && (
        <div className="relative self-start mt-1" ref={remakeMenuRef}>
          <button
            onClick={() => setShowRemakeMenu(!showRemakeMenu)}
            className="remake-btn"
            title="Remake with different model"
            disabled={isRemaking}
          >
            {isRemaking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Remake dropdown */}
          {showRemakeMenu && (
            <div className="remake-dropdown max-h-[300px] overflow-y-auto">
              <p className="px-3 py-1 text-[10px] text-white/30 uppercase tracking-wide">Remake with</p>
              {Object.entries(TEXT_MODELS).map(([id, name]) => (
                <button
                  key={id}
                  onClick={() => {
                    onRemake(message.id, id);
                    setShowRemakeMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-white/60 hover:text-white hover:bg-white/5"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// Typing indicator with smooth wave animation
function TypingIndicator() {
  const barStyle = (delay) => ({
    display: 'inline-block',
    width: '3px',
    borderRadius: '3px',
    background: 'linear-gradient(to top, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.9))',
    animation: 'thinkingWave 1.2s ease-in-out infinite',
    animationDelay: `${delay}s`,
    transition: 'none',
  });

  const textStyle = {
    fontSize: '12px',
    fontWeight: '500',
    letterSpacing: '0.5px',
    background: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.8), rgba(255,255,255,0.3))',
    backgroundSize: '200% 100%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    animation: 'thinkingTextShimmer 2s linear infinite',
    transition: 'none',
  };

  return (
    <div className="flex items-start gap-2 justify-start animate-fade-in">
      <div className="message-bubble message-assistant">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '18px' }}>
            <span style={barStyle(0)} />
            <span style={barStyle(0.1)} />
            <span style={barStyle(0.2)} />
            <span style={barStyle(0.3)} />
            <span style={barStyle(0.4)} />
          </div>
          <span style={textStyle}>Thinking</span>
        </div>
      </div>
    </div>
  );
}

// Main Chat Interface
export default function ChatInterface() {
  const {
    settings,
    currentChatId,
    sidebarOpen,
    setSidebarOpen,
    createChat,
    addMessage,
    updateMessage,
    updateSettings,
    deleteMessage,
    addFiles,
    addToGallery,
    getCurrentChat,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState(null);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [collapsedMessages, setCollapsedMessages] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [remakingMessageId, setRemakingMessageId] = useState(null);
  const [isEnhanceHovered, setIsEnhanceHovered] = useState(false);
  const [isWebSearchHovered, setIsWebSearchHovered] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const dropZoneRef = useRef(null);
  const fileInputRef = useRef(null);

  const currentChat = getCurrentChat();
  const isImageMode = settings.generationMode === 'image';

  // Track if user has manually scrolled up during streaming
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const messagesContainerRef = useRef(null);

  // Handle scroll to detect if user scrolled up
  const handleScroll = useCallback((e) => {
    const container = e.target;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setUserScrolledUp(!isNearBottom);
  }, []);

  // Only auto-scroll if user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentChat?.messages, userScrolledUp]);

  // Reset scroll tracking when streaming ends
  useEffect(() => {
    if (!streamingMessageId) {
      setUserScrolledUp(false);
    }
  }, [streamingMessageId]);

  useEffect(() => {
    if (!currentChatId) createChat();
  }, [currentChatId, createChat]);

  // Handle mobile viewport height (for virtual keyboard)
  useEffect(() => {
    const setViewportHeight = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    
    // Also listen for visual viewport changes (for mobile keyboard)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setViewportHeight);
    }

    return () => {
      window.removeEventListener('resize', setViewportHeight);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', setViewportHeight);
      }
    };
  }, []);

  // Scroll input into view when focused on mobile
  const handleInputFocus = useCallback(() => {
    if (window.innerWidth < 768) {
      setTimeout(() => {
        textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [input]);

  // Auto-collapse long messages
  useEffect(() => {
    if (currentChat?.messages) {
      const newCollapsed = new Set();
      currentChat.messages.forEach((msg, index) => {
        if (msg.role === 'assistant' && index < currentChat.messages.length - 3) {
          newCollapsed.add(msg.id);
        }
      });
      setCollapsedMessages(newCollapsed);
    }
  }, [currentChat?.messages?.length]);

  const toggleCollapse = (messageId) => {
    setCollapsedMessages(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === dropZoneRef.current) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    await processFiles(files);
  }, []);

  // Process files for attachment
  const processFiles = async (files) => {
    for (const file of files) {
      try {
        const isImage = file.type.startsWith('image/');
        const data = await fileToBase64(file);
        
        setAttachments(prev => [...prev, {
          name: file.name,
          type: isImage ? 'image' : 'file',
          data: data,
          mimeType: file.type,
        }]);
      } catch (error) {
        console.error('Error processing file:', error);
      }
    }
  };

  // Handle file input change
  const handleFileInputChange = async (e) => {
    const files = Array.from(e.target.files);
    await processFiles(files);
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle paste (Ctrl+V)
  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
    
    if (imageItems.length > 0) {
      e.preventDefault();
      
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          try {
            const data = await fileToBase64(file);
            setAttachments(prev => [...prev, {
              name: `pasted-image-${Date.now()}.png`,
              type: 'image',
              data: data,
              mimeType: file.type,
            }]);
          } catch (error) {
            console.error('Error processing pasted image:', error);
          }
        }
      }
    }
  }, []);

  // Remove attachment
  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Open file picker
  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // AI-powered enhance
  const handleEnhancePrompt = async () => {
    if (!input.trim() || isEnhancing) return;
    setIsEnhancing(true);
    
    try {
      const enhanced = await enhancePromptWithAI(
        input, 
        isImageMode, 
        settings.apiKey, 
        settings.currentModel
      );
      setInput(enhanced);
    } catch (error) {
      console.error('Enhancement error:', error);
    } finally {
      setIsEnhancing(false);
    }
  };

  // Remake message with different model
  const handleRemake = async (messageId, newModel) => {
    if (!currentChat) return;
    
    setRemakingMessageId(messageId);
    
    const msgIndex = currentChat.messages.findIndex(m => m.id === messageId);
    if (msgIndex < 1) return;
    
    const userMessage = currentChat.messages[msgIndex - 1];
    if (userMessage.role !== 'user') return;
    
    try {
      const messages = currentChat.messages.slice(0, msgIndex).map(m => ({ 
        role: m.role, 
        content: m.content 
      }));

      let fullContent = '';
      for await (const chunk of streamChatCompletion(messages, {
        model: newModel,
        apiKey: settings.apiKey,
        systemPrompt: settings.systemPrompt,
        temperature: settings.temperature,
      })) {
        fullContent += chunk;
        updateMessage(currentChatId, messageId, fullContent);
      }
    } catch (error) {
      console.error('Remake error:', error);
    } finally {
      setRemakingMessageId(null);
    }
  };

  const handleSubmit = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    let userMessage = input.trim();
    
    // Add attachment info to message
    if (attachments.length > 0) {
      const attachmentInfo = attachments.map(a => `[${a.type}: ${a.name}]`).join(' ');
      userMessage = userMessage ? `${userMessage}\n\n${attachmentInfo}` : attachmentInfo;
    }
    
    setInput('');
    setAttachments([]);

    let chatId = currentChatId || createChat();
    
    // Create message with attachments
    const messageData = {
      role: 'user',
      content: userMessage,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    addMessage(chatId, messageData);
    setIsLoading(true);
    setIsWaitingForResponse(true);

    try {
      if (settings.generationMode === 'image') {
        const result = await generateImage(userMessage, {
          model: settings.currentImageModel,
          apiKey: settings.apiKey,
        });

        setIsWaitingForResponse(false);
        
        if (result.type === 'base64' || result.type === 'url') {
          addToGallery({ type: result.type, data: result.data, prompt: userMessage });
          addMessage(chatId, { role: 'assistant', content: '', type: 'image', image: result });
        } else {
          addMessage(chatId, { role: 'assistant', content: result.data });
        }
      } else {
        const messages = currentChat?.messages.map(m => ({ role: m.role, content: m.content })) || [];
        
        // Detect URLs in the message for automatic analysis
        const detectedUrls = extractUrls(userMessage);
        const shouldUseWebSearch = settings.webSearchMode || detectedUrls.length > 0;

        const assistantMsgId = addMessage(chatId, { role: 'assistant', content: '' });
        setStreamingMessageId(assistantMsgId);

        let fullContent = '';
        let firstChunkReceived = false;
        
        // Use web search mode if enabled or URLs detected
        if (shouldUseWebSearch) {
          for await (const chunk of streamWebSearchCompletion(userMessage, detectedUrls, {
            model: settings.currentModel,
            apiKey: settings.apiKey,
            systemPrompt: settings.systemPrompt,
            temperature: settings.temperature,
            previousMessages: messages,
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })) {
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              setIsWaitingForResponse(false);
              // Clear the loading indicator
              fullContent = '';
            }
            fullContent += chunk;
            updateMessage(chatId, assistantMsgId, fullContent);
          }
        } else {
          // Standard chat completion
          messages.push({ role: 'user', content: userMessage });
          
          for await (const chunk of streamChatCompletion(messages, {
            model: settings.currentModel,
            apiKey: settings.apiKey,
            systemPrompt: settings.systemPrompt,
            temperature: settings.temperature,
            agentMode: settings.agentMode,
          })) {
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              setIsWaitingForResponse(false);
            }
            fullContent += chunk;
            updateMessage(chatId, assistantMsgId, fullContent);
          }
        }

        setStreamingMessageId(null);

        if (settings.agentMode) {
          const parsedFiles = agentManager.parseFilesFromResponse(fullContent);
          if (parsedFiles.length > 0) {
            addFiles(chatId, parsedFiles);
            agentManager.addFiles(parsedFiles);
          }
        }
      }
    } catch (error) {
      console.error('API Error:', error);
      if (streamingMessageId) {
        deleteMessage(chatId, streamingMessageId);
        setStreamingMessageId(null);
      }
    } finally {
      setIsLoading(false);
      setIsWaitingForResponse(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleImageMode = () => {
    updateSettings({
      generationMode: isImageMode ? 'text' : 'image'
    });
  };

  const toggleWebSearchMode = () => {
    updateSettings({
      webSearchMode: !settings.webSearchMode
    });
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div
      ref={dropZoneRef}
      className={`flex-1 flex flex-col h-full bg-transparent drop-zone ${isDragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Fixed mobile menu button */}
      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed top-3 left-3 z-50 btn-icon md:hidden mobile-menu-btn"
          title="Show sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Header with sidebar toggle */}
      <header className="flex items-center justify-between px-5 py-4">
        <button onClick={toggleSidebar} className="btn-icon hidden md:flex" title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
          {sidebarOpen ? (
            <PanelLeftClose className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>
        
        {/* Spacer for mobile when sidebar is closed */}
        <div className="w-10 md:hidden" />
        
        <div className="flex items-center gap-2">
          {settings.webSearchMode && (
            <span className="badge badge-accent" style={{ background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
              <Search className="w-3 h-3 text-blue-400" />
              <span className="text-blue-400">Live Search</span>
            </span>
          )}
          {settings.agentMode && (
            <span className="badge badge-accent">
              <Zap className="w-3 h-3" />
              Agent
            </span>
          )}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-5 py-4 messages-container"
        onScroll={handleScroll}
      >
        {!currentChat?.messages?.length ? (
          <div className="flex flex-col items-center justify-center h-full animate-fade-in">
            <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6 text-white/30" />
            </div>
            <p className="text-white/20 text-sm mb-1">Start a conversation</p>
            <p className="text-white/10 text-xs">Drag & drop files or type below</p>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto px-4">
            {currentChat.messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                isCollapsed={collapsedMessages.has(message.id)}
                onToggleCollapse={toggleCollapse}
                onRemake={message.role === 'assistant' ? handleRemake : null}
                isRemaking={remakingMessageId === message.id}
                isStreaming={streamingMessageId === message.id}
                onImageClick={setFullscreenImage}
              />
            ))}
            {isWaitingForResponse && <TypingIndicator />}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Input with ambient glow */}
      <div className="p-5 pt-2 chat-input-wrapper">
        <div className="max-w-2xl mx-auto">
          <div className={`ambient-glow ${input.trim() || attachments.length > 0 ? 'has-text' : ''}`}>
            {/* Attachment preview */}
            <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
            
            <div className="chat-input-container items-center">
              {/* Mode Toggle */}
              <button
                onClick={toggleImageMode}
                className={`mode-toggle-btn flex-shrink-0 ${isImageMode ? 'active' : ''}`}
                title={isImageMode ? 'Switch to Text' : 'Switch to Image'}
              >
                {isImageMode ? (
                  <Image className="w-4 h-4" />
                ) : (
                  <MessageSquare className="w-4 h-4" />
                )}
              </button>

              {/* Web Search Toggle */}
              <button
                onClick={toggleWebSearchMode}
                onMouseEnter={() => setIsWebSearchHovered(true)}
                onMouseLeave={() => setIsWebSearchHovered(false)}
                className={`mode-toggle-btn flex-shrink-0 flex items-center gap-1 transition-all duration-200 ${
                  settings.webSearchMode
                    ? 'text-blue-400 bg-blue-400/10'
                    : 'text-white/30 hover:text-white/60'
                }`}
                title={settings.webSearchMode ? 'Disable Live Search' : 'Enable Live Search'}
              >
                <Search className="w-4 h-4" />
                <span
                  className={`text-xs overflow-hidden whitespace-nowrap transition-all duration-200 ${
                    isWebSearchHovered || settings.webSearchMode ? 'max-w-[50px] opacity-100' : 'max-w-0 opacity-0'
                  }`}
                >
                  {settings.webSearchMode ? 'On' : 'Live'}
                </span>
              </button>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.html,.css"
                onChange={handleFileInputChange}
                className="hidden"
              />

              {/* Input */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={handleInputFocus}
                placeholder={
                    isImageMode
                      ? "Describe an image..."
                      : settings.webSearchMode
                        ? "Ask anything with live search..."
                        : "Message..."
                  }
                className="input-minimal"
                rows={1}
                disabled={isLoading}
              />

              {/* Enhance button */}
              <button
                onClick={handleEnhancePrompt}
                onMouseEnter={() => setIsEnhanceHovered(true)}
                onMouseLeave={() => setIsEnhanceHovered(false)}
                disabled={isEnhancing || !input.trim()}
                className={`mode-toggle-btn flex-shrink-0 flex items-center gap-1 transition-all duration-200 ${
                  input.trim() ? 'text-white/30 hover:text-white/60' : 'text-white/10 cursor-default'
                }`}
                title="Enhance prompt"
              >
                {isEnhancing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                <span
                  className={`text-xs overflow-hidden whitespace-nowrap transition-all duration-200 ${
                    isEnhanceHovered && input.trim() ? 'max-w-[60px] opacity-100' : 'max-w-0 opacity-0'
                  }`}
                >
                  Enhance
                </span>
              </button>

              {/* Upload button */}
              <button
                onClick={openFilePicker}
                className={`mode-toggle-btn flex-shrink-0 ${attachments.length > 0 ? 'text-white/60' : 'opacity-50 hover:opacity-100'}`}
                title="Upload files (or drag & drop, or Ctrl+V)"
              >
                <Upload className="w-4 h-4" />
                {attachments.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-white/20 rounded-full text-[10px] flex items-center justify-center">
                    {attachments.length}
                  </span>
                )}
              </button>

              {/* Send Button */}
              <button
                onClick={handleSubmit}
                disabled={isLoading || (!input.trim() && attachments.length === 0)}
                className={`flex-shrink-0 p-2 rounded-full transition-all ${
                  (input.trim() || attachments.length > 0) && !isLoading
                    ? 'bg-white text-black hover:bg-white/90 active:scale-95'
                    : 'bg-white/10 text-white/20'
                }`}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

        </div>
      </div>
      {/* Fullscreen Image Modal */}
      <ImageModal
        isOpen={!!fullscreenImage}
        onClose={() => setFullscreenImage(null)}
        image={fullscreenImage}
      />
    </div>
  );
}
