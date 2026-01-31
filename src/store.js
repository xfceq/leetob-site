import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

// Chat store with persistence
export const useChatStore = create(
  persist(
    (set, get) => ({
      // Chats
      chats: [],
      currentChatId: null,

      // Settings
      settings: {
        apiKey: 'sk-public',
        systemPrompt: 'You are a helpful assistant.',
        temperature: 0.7,
        darkMode: true,
        agentMode: false,
        currentModel: 'gemini-2.5-flash',
        currentImageModel: 'gemini-2.5-flash-image',
        generationMode: 'text', // 'text' or 'image'
      },

      // Gallery - stored images
      gallery: [],

      // UI State (not persisted)
      sidebarOpen: false,
      settingsOpen: false,
      galleryOpen: false,

      // Actions - Chats
      createChat: () => {
        const state = get();
        // Check if current chat is empty - don't create new one
        const currentChat = state.chats.find(c => c.id === state.currentChatId);
        if (currentChat && currentChat.messages.length === 0 && currentChat.title === 'New Chat') {
          // Current chat is empty, just return its id
          return currentChat.id;
        }
        
        const newChat = {
          id: generateId(),
          title: 'New Chat',
          messages: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          files: [], // VFS files for this chat
        };
        set(state => ({
          chats: [newChat, ...state.chats],
          currentChatId: newChat.id,
        }));
        return newChat.id;
      },

      deleteChat: (chatId) => {
        set(state => {
          const newChats = state.chats.filter(c => c.id !== chatId);
          const newCurrentId = state.currentChatId === chatId
            ? (newChats[0]?.id || null)
            : state.currentChatId;
          return {
            chats: newChats,
            currentChatId: newCurrentId,
          };
        });
      },

      selectChat: (chatId) => {
        set({ currentChatId: chatId });
      },

      pinChat: (chatId) => {
        set(state => ({
          chats: state.chats.map(chat =>
            chat.id === chatId ? { ...chat, pinned: !chat.pinned } : chat
          ),
        }));
      },

      deleteAllChats: () => {
        set(state => {
          // Keep only pinned chats
          const pinnedChats = state.chats.filter(c => c.pinned);
          const newCurrentId = pinnedChats[0]?.id || null;
          return {
            chats: pinnedChats,
            currentChatId: newCurrentId,
          };
        });
      },

      updateChatTitle: (chatId, title) => {
        set(state => ({
          chats: state.chats.map(chat =>
            chat.id === chatId ? { ...chat, title, updatedAt: Date.now() } : chat
          ),
        }));
      },

      // Actions - Messages
      addMessage: (chatId, message) => {
        const messageWithId = {
          id: generateId(),
          ...message,
          timestamp: Date.now(),
        };
        set(state => ({
          chats: state.chats.map(chat => {
            if (chat.id === chatId) {
              const messages = [...chat.messages, messageWithId];
              // Auto-generate title from first user message
              let title = chat.title;
              if (chat.title === 'New Chat' && message.role === 'user') {
                title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
              }
              return {
                ...chat,
                messages,
                title,
                updatedAt: Date.now(),
              };
            }
            return chat;
          }),
        }));
        return messageWithId.id;
      },

      updateMessage: (chatId, messageId, content) => {
        set(state => ({
          chats: state.chats.map(chat => {
            if (chat.id === chatId) {
              return {
                ...chat,
                messages: chat.messages.map(msg =>
                  msg.id === messageId ? { ...msg, content } : msg
                ),
                updatedAt: Date.now(),
              };
            }
            return chat;
          }),
        }));
      },

      deleteMessage: (chatId, messageId) => {
        set(state => ({
          chats: state.chats.map(chat => {
            if (chat.id === chatId) {
              return {
                ...chat,
                messages: chat.messages.filter(msg => msg.id !== messageId),
                updatedAt: Date.now(),
              };
            }
            return chat;
          }),
        }));
      },

      // Actions - Files (VFS)
      addFiles: (chatId, files) => {
        set(state => ({
          chats: state.chats.map(chat => {
            if (chat.id === chatId) {
              const existingFilenames = new Set(chat.files.map(f => f.filename));
              const newFiles = files.filter(f => !existingFilenames.has(f.filename));
              const updatedFiles = chat.files.map(existing => {
                const updated = files.find(f => f.filename === existing.filename);
                return updated ? { ...existing, code: updated.code } : existing;
              });
              return {
                ...chat,
                files: [...updatedFiles, ...newFiles],
                updatedAt: Date.now(),
              };
            }
            return chat;
          }),
        }));
      },

      clearFiles: (chatId) => {
        set(state => ({
          chats: state.chats.map(chat =>
            chat.id === chatId ? { ...chat, files: [], updatedAt: Date.now() } : chat
          ),
        }));
      },

      // Actions - Settings
      updateSettings: (updates) => {
        set(state => ({
          settings: { ...state.settings, ...updates },
        }));
      },

      // Actions - Gallery
      addToGallery: (image) => {
        const imageWithId = {
          id: generateId(),
          ...image,
          createdAt: Date.now(),
        };
        set(state => ({
          gallery: [imageWithId, ...state.gallery],
        }));
        return imageWithId.id;
      },

      removeFromGallery: (imageId) => {
        set(state => ({
          gallery: state.gallery.filter(img => img.id !== imageId),
        }));
      },

      clearGallery: () => {
        set({ gallery: [] });
      },

      // Actions - UI
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setGalleryOpen: (open) => set({ galleryOpen: open }),

      // Getters
      getCurrentChat: () => {
        const state = get();
        return state.chats.find(c => c.id === state.currentChatId);
      },

      getSortedChats: () => {
        const state = get();
        return [...state.chats].sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return b.updatedAt - a.updatedAt;
        });
      },
    }),
    {
      name: 'ai-chat-storage',
      partialize: (state) => ({
        chats: state.chats,
        currentChatId: state.currentChatId,
        settings: state.settings,
        gallery: state.gallery,
      }),
    }
  )
);

export default useChatStore;
