import { useRef, useState, useEffect } from 'react';
import { Send, Paperclip, Image, X, Loader2 } from 'lucide-react';
import { chatApi } from '../../services/api';

interface Props {
  conversationId: string;
  onSend: (msg: { content?: string; type: string; attachmentUrl?: string; attachmentName?: string; attachmentSize?: number }) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
}

export default function MessageInput({ conversationId, onSend, onTyping, disabled }: Props) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; size: number; type: 'image' | 'file' } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textRef.current) {
      textRef.current.style.height = 'auto';
      textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  const handleTyping = (value: string) => {
    setText(value);
    onTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), 1500);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && !preview) return;
    if (preview) {
      onSend({ content: trimmed || undefined, type: preview.type, attachmentUrl: preview.url, attachmentName: preview.name, attachmentSize: preview.size });
      setPreview(null);
    } else {
      onSend({ content: trimmed, type: 'text' });
    }
    setText('');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    onTyping(false);
    setTimeout(() => textRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, forceType?: 'image' | 'file') => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be under 10 MB');
      return;
    }

    setUploading(true);
    try {
      const res = await chatApi.uploadAttachment(file);
      const { url, name, size, type } = res.data;
      setPreview({ url, name, size, type: forceType ?? type });
    } catch {
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const canSend = !disabled && !uploading && (text.trim().length > 0 || preview !== null);

  return (
    <div className="border-t border-gray-200 bg-white p-3">
      {/* Attachment preview */}
      {preview && (
        <div className="mb-2 flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
          {preview.type === 'image' ? (
            <img src={preview.url} alt="" className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <Paperclip className="w-4 h-4 text-indigo-600" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 truncate">{preview.name}</p>
            <p className="text-xs text-gray-500">{(preview.size / 1024).toFixed(1)} KB</p>
          </div>
          <button onClick={() => setPreview(null)} className="p-1 hover:bg-gray-200 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Attach buttons */}
        <div className="flex gap-1 pb-1">
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled || uploading}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40"
            title="Send image"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Image className="w-4 h-4" />}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40"
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
        </div>

        {/* Text area */}
        <textarea
          ref={textRef}
          value={text}
          onChange={e => handleTyping(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent placeholder:text-gray-400 disabled:opacity-50 leading-relaxed"
          style={{ maxHeight: 120 }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="p-2.5 pb-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 self-end"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Hidden file inputs */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFileSelect(e, 'image')} />
      <input ref={fileInputRef} type="file" accept="*/*" className="hidden" onChange={e => handleFileSelect(e)} />
    </div>
  );
}
