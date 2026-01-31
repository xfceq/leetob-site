import React, { useState } from 'react';
import {
  X,
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  Image,
  Eye,
  EyeOff,
  ChevronDown,
  Zap,
  Sparkles,
  Pin,
  PinOff,
} from 'lucide-react';
import useChatStore from '../store';
import { TEXT_MODELS, IMAGE_MODELS } from '../api';

// Settings Modal - Glassmorphism
function SettingsModal({ isOpen, onClose }) {
  const { settings, updateSettings, deleteAllChats, chats } = useChatStore();
  const [showApiKey, setShowApiKey] = useState(false);
  const [localApiKey, setLocalApiKey] = useState(settings.apiKey);
  const [localSystemPrompt, setLocalSystemPrompt] = useState(settings.systemPrompt);
  const [localTemperature, setLocalTemperature] = useState(settings.temperature);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Handle close with animation
  const handleClose = React.useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  }, [onClose, isClosing]);

  if (!isOpen) return null;

  const handleSave = () => {
    updateSettings({
      apiKey: localApiKey,
      systemPrompt: localSystemPrompt,
      temperature: localTemperature,
    });
    handleClose();
  };

  const handleDeleteAllChats = () => {
    deleteAllChats();
    setShowDeleteConfirm(false);
  };

  const unpinnedCount = chats.filter(c => !c.pinned).length;

  return (
    <div className={`modal-overlay ${isClosing ? 'animate-fade-out' : ''}`} onClick={handleClose}>
      <div className={`modal-content w-full max-w-sm ${isClosing ? 'animate-scale-out' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-base font-medium text-white">Settings</h2>
          <button onClick={handleClose} className="btn-icon">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* API Key */}
          <div className="animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
            <label className="block text-xs text-white/40 uppercase tracking-wide mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                className="input-field pr-10 text-sm"
                placeholder="sk-..."
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* System Prompt */}
          <div className="animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
            <label className="block text-xs text-white/40 uppercase tracking-wide mb-2">
              System Prompt
            </label>
            <textarea
              value={localSystemPrompt}
              onChange={(e) => setLocalSystemPrompt(e.target.value)}
              className="input-field min-h-[80px] text-sm"
              placeholder="You are a helpful assistant..."
            />
          </div>

          {/* Temperature */}
          <div className="animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-white/40 uppercase tracking-wide">
                Temperature
              </label>
              <span className="text-xs text-white/60 font-mono">{localTemperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={localTemperature}
              onChange={(e) => setLocalTemperature(parseFloat(e.target.value))}
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white"
            />
          </div>

          {/* Delete All Chats */}
          <div className="animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            <label className="block text-xs text-white/40 uppercase tracking-wide mb-2">
              Danger Zone
            </label>
            {showDeleteConfirm ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="btn-ghost flex-1 text-xs press-effect"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAllChats}
                  className="flex-1 py-2 px-3 rounded-xl bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 press-effect"
                >
                  Confirm Delete
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={unpinnedCount === 0}
                className="w-full py-2 px-3 rounded-xl glass text-red-400/70 text-xs font-medium hover:bg-red-500/10 hover:text-red-400 press-effect disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete All Chats ({unpinnedCount} unpinned)
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-white/5">
          <button onClick={handleClose} className="btn-ghost flex-1 press-effect">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary flex-1 press-effect">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Model Selector - Glassmorphism dropdown
function ModelSelector() {
  const { settings, updateSettings } = useChatStore();
  const [isOpen, setIsOpen] = useState(false);

  const isImageMode = settings.generationMode === 'image';
  const models = isImageMode ? IMAGE_MODELS : TEXT_MODELS;
  const currentModel = isImageMode ? settings.currentImageModel : settings.currentModel;
  const currentModelName = models[currentModel] || currentModel;

  const handleModelSelect = (modelId) => {
    if (isImageMode) {
      updateSettings({ currentImageModel: modelId });
    } else {
      updateSettings({ currentModel: modelId });
    }
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2.5 w-full rounded-xl glass
                   hover:bg-white/[0.05] text-sm press-effect"
      >
        <span className="truncate flex-1 text-left text-white/70">{currentModelName}</span>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="dropdown left-0 right-0 max-h-56 overflow-y-auto">
            {Object.entries(models).map(([id, name], index) => (
              <button
                key={id}
                onClick={() => handleModelSelect(id)}
                className={`dropdown-item w-full text-left ${currentModel === id ? 'dropdown-item-active' : ''}`}
                style={{ animationDelay: `${index * 30}ms` }}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Main Sidebar - Glassmorphism design
export default function Sidebar() {
  const {
    currentChatId,
    settings,
    sidebarOpen,
    settingsOpen,
    setSidebarOpen,
    setSettingsOpen,
    setGalleryOpen,
    createChat,
    selectChat,
    deleteChat,
    pinChat,
    updateSettings,
    getSortedChats,
  } = useChatStore();

  const sortedChats = getSortedChats();

  const handleNewChat = () => {
    createChat();
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  const handleSelectChat = (chatId) => {
    selectChat(chatId);
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? 'relative' : 'absolute'} inset-y-0 left-0 z-40 w-64
                    floating-sidebar flex flex-col transform transition-all duration-300 ease-out
                    ${sidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-full md:translate-x-0 md:w-0 md:opacity-0 md:overflow-hidden'}`}
        style={{ borderRadius: sidebarOpen ? '24px 0 0 24px' : '0' }}
      >
        {/* Header */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg glass-strong flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white/60" />
              </div>
              <h1 className="text-sm font-medium text-white/80">leetob</h1>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="btn-icon md:hidden"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* New Chat */}
          <button
            onClick={handleNewChat}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm hover-lift"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Model & Agent Mode */}
        <div className="px-4 pb-4 space-y-3 border-b border-white/5">
          <ModelSelector />

          {/* Agent Mode Toggle */}
          <button
            onClick={() => updateSettings({ agentMode: !settings.agentMode })}
            className={`w-full py-2.5 px-3 rounded-xl text-xs font-medium flex items-center justify-center gap-2
                       press-effect ${
              settings.agentMode
                ? 'bg-white text-black'
                : 'glass text-white/40 hover:text-white/60 hover:bg-white/[0.05]'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Agent {settings.agentMode ? 'On' : 'Off'}
          </button>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto p-2">
          {sortedChats.length === 0 ? (
            <div className="text-center py-12 px-4 animate-fade-in">
              <div className="w-10 h-10 rounded-xl glass flex items-center justify-center mx-auto mb-3">
                <MessageSquare className="w-5 h-5 text-white/20" />
              </div>
              <p className="text-xs text-white/20">No chats yet</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {sortedChats.map((chat, index) => (
                <div
                  key={chat.id}
                  className={`sidebar-item group animate-fade-in-up ${
                    currentChatId === chat.id ? 'sidebar-item-active' : ''
                  }`}
                  style={{ animationDelay: `${index * 40}ms` }}
                  onClick={() => handleSelectChat(chat.id)}
                >
                  {chat.pinned ? (
                    <Pin className="w-4 h-4 flex-shrink-0 text-white/60" />
                  ) : (
                    <MessageSquare className="w-4 h-4 flex-shrink-0 opacity-50" />
                  )}
                  <span className="flex-1 truncate text-sm">{chat.title}</span>
                  
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        pinChat(chat.id);
                      }}
                      className="p-1 rounded-lg glass hover:text-white/80 transition-all"
                      title={chat.pinned ? "Unpin" : "Pin"}
                    >
                      {chat.pinned ? (
                        <PinOff className="w-3 h-3" />
                      ) : (
                        <Pin className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChat(chat.id);
                      }}
                      className="p-1 rounded-lg glass hover:text-red-400 transition-all"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-white/5 space-y-0.5">
          <button
            onClick={() => setGalleryOpen(true)}
            className="sidebar-item w-full hover-lift"
          >
            <Image className="w-4 h-4" />
            <span className="text-sm">Gallery</span>
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="sidebar-item w-full hover-lift"
          >
            <Settings className="w-4 h-4" />
            <span className="text-sm">Settings</span>
          </button>
        </div>
      </aside>

      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
