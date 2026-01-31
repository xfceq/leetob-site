import React, { useState } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  Trash2,
  Image as ImageIcon,
  Maximize2,
} from 'lucide-react';
import useChatStore from '../store';

// Full Image Modal - Animated (exported for use in ChatInterface)
export function ImageModal({ isOpen, onClose, image }) {
  const [copied, setCopied] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Handle close with animation
  const handleClose = React.useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200); // Match animation duration
  }, [onClose]);

  // Handle Escape key to close
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isClosing) {
        handleClose();
      }
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, isClosing, handleClose]);

  if (!isOpen || !image) return null;

  const handleCopy = async () => {
    try {
      if (image.type === 'base64' || image.type === 'url') {
        const response = await fetch(image.data);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      try {
        await navigator.clipboard.writeText(image.data);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error('Failed to copy:', e);
      }
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = image.data;
    link.download = `image-${image.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBackgroundClick = (e) => {
    if (e.target === e.currentTarget && !isClosing) {
      e.stopPropagation();
      handleClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 bg-black/95 flex items-center justify-center z-[100] p-4 ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleBackgroundClick}
    >
      {/* Fixed close button in top-right corner of screen */}
      <button
        onClick={(e) => { e.stopPropagation(); handleClose(); }}
        className="fixed top-4 right-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all press-effect z-[101]"
        title="Close (Esc)"
      >
        <X className="w-5 h-5" />
      </button>

      <div className={`relative max-w-5xl max-h-[90vh] flex flex-col ${isClosing ? 'animate-scale-out' : 'animate-scale-in'}`} onClick={e => e.stopPropagation()}>
        {/* Controls on image */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          <button
            onClick={handleCopy}
            className="p-2.5 bg-black/50 hover:bg-black/70 text-white rounded-full transition-all press-effect backdrop-blur-sm"
            title="Copy"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={handleDownload}
            className="p-2.5 bg-black/50 hover:bg-black/70 text-white rounded-full transition-all press-effect backdrop-blur-sm"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        {/* Image */}
        <img
          src={image.data}
          alt={image.prompt || 'Generated image'}
          className="max-w-full max-h-[85vh] object-contain rounded-xl"
        />

        {/* Prompt */}
        {image.prompt && (
          <div className="mt-4 p-4 bg-white/5 rounded-xl animate-fade-in-up">
            <p className="text-xs text-white/40 uppercase tracking-wide mb-1">Prompt</p>
            <p className="text-sm text-white/70 leading-relaxed">{image.prompt}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Gallery Grid - Animated minimal
export default function Gallery({ isOpen, onClose }) {
  const { gallery, removeFromGallery, clearGallery } = useChatStore();
  const [selectedImage, setSelectedImage] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
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

  // Reset selected image when gallery closes
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedImage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClearGallery = () => {
    if (confirmClear) {
      clearGallery();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  return (
    <div className={`modal-overlay ${isClosing ? 'animate-fade-out' : ''}`} onClick={handleClose}>
      <div className={`modal-content w-full max-w-4xl max-h-[85vh] flex flex-col ${isClosing ? 'animate-scale-out' : ''}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="animate-fade-in-up">
            <h2 className="text-base font-medium text-white">Gallery</h2>
            <p className="text-xs text-white/30 mt-0.5">{gallery.length} images</p>
          </div>
          <div className="flex items-center gap-2">
            {gallery.length > 0 && (
              <button
                onClick={handleClearGallery}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all press-effect ${
                  confirmClear
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-white/5 text-white/40 hover:text-white/60'
                }`}
              >
                {confirmClear ? 'Confirm' : 'Clear'}
              </button>
            )}
            <button onClick={handleClose} className="btn-icon">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {gallery.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 animate-fade-in">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-3">
                <ImageIcon className="w-5 h-5 text-white/20" />
              </div>
              <p className="text-sm text-white/20">No images yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {gallery.map((image, index) => (
                <div
                  key={image.id}
                  className="group relative aspect-square bg-white/5 rounded-xl overflow-hidden cursor-pointer
                             hover-lift animate-fade-in-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                  onClick={() => setSelectedImage(image)}
                >
                  {image.type === 'base64' || image.type === 'url' ? (
                    <img
                      src={image.data}
                      alt={image.prompt || 'Generated'}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-white/20" />
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent 
                                  opacity-0 group-hover:opacity-100 transition-all duration-300
                                  flex items-end justify-between p-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage(image);
                      }}
                      className="p-2 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 
                                 transition-all press-effect"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromGallery(image.id);
                      }}
                      className="p-2 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-red-500/50 
                                 transition-all press-effect"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full Image Modal */}
      <ImageModal
        isOpen={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        image={selectedImage}
      />
    </div>
  );
}

// Chat Image - Animated minimal
export function ChatImage({ image, onClick }) {
  return (
    <div
      className="relative group cursor-pointer rounded-xl overflow-hidden max-w-xs hover-lift"
      onClick={onClick}
    >
      <img
        src={image.data}
        alt={image.prompt || 'Generated'}
        className="w-full h-auto transition-transform duration-300 group-hover:scale-[1.02]"
      />
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 
                      transition-all duration-300 flex items-center justify-center">
        <div className="p-3 bg-white/10 backdrop-blur-sm rounded-full">
          <Maximize2 className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}
