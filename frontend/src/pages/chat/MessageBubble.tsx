import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { format, isToday, isYesterday } from 'date-fns';
import { Pencil, Trash2, Check, X, Download, FileText } from 'lucide-react';

export interface InviteAppointment {
  id: string;
  status: 'invited' | 'pending' | 'approved' | 'rejected';
  inviteReason?: string;
  reason?: string;
  requestedDate?: string;
  scheduledDate?: string;
}

export interface Message {
  id: string;
  senderId: string;
  content?: string;
  type: 'text' | 'image' | 'file' | 'invite';
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  relatedAppointmentId?: string;
  appointment?: InviteAppointment | null;
  isDeleted: boolean;
  editedAt?: string;
  createdAt: string;
}

interface Props {
  msg: Message;
  isMine: boolean;
  showAvatar: boolean;
  avatarInitials: string;
  primaryColor: string;
  onEdit: (msg: Message) => void;
  onDelete: (msgId: string) => void;
}

function formatTime(iso: string, yesterdayLabel: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return `${yesterdayLabel} ${format(d, 'HH:mm')}`;
  return format(d, 'MMM d, HH:mm');
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Defense-in-depth: even though the backend validates attachmentUrl to
// only allow Supabase storage URLs, the frontend should refuse to render
// anything that isn't http(s) under *.supabase.co. Blocks javascript:,
// data:, vbscript:, and any other scheme that could fire on click.
function isSafeAttachmentUrl(u: string | undefined): u is string {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return /\.supabase\.co$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export default function MessageBubble({ msg, isMine, showAvatar, avatarInitials, primaryColor, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editVal, setEditVal] = useState(msg.content || '');
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editMode) {
      editRef.current?.focus();
      editRef.current?.select();
    }
  }, [editMode]);

  const handleEditSave = () => {
    if (editVal.trim() && editVal.trim() !== msg.content) {
      onEdit({ ...msg, content: editVal.trim() });
    }
    setEditMode(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
    if (e.key === 'Escape') { setEditMode(false); setEditVal(msg.content || ''); }
  };

  if (msg.isDeleted) {
    return (
      <div className={`flex items-end gap-2 mb-1 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className="w-7 flex-shrink-0" />
        <span className="text-xs text-gray-400 italic px-3 py-1.5">{t('chat.message_deleted')}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-end gap-2 mb-1 group ${isMine ? 'flex-row-reverse' : 'flex-row'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <div className="w-7 flex-shrink-0 self-end">
        {showAvatar && !isMine && (
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: primaryColor }}>
            {avatarInitials}
          </div>
        )}
      </div>

      {/* Bubble */}
      <div className={`relative max-w-[72%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
        {editMode ? (
          <div className="flex flex-col gap-1 w-full min-w-[200px]">
            <textarea
              ref={editRef}
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={2}
              className="rounded-xl border border-indigo-400 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="flex gap-1 justify-end">
              <button onClick={() => { setEditMode(false); setEditVal(msg.content || ''); }} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"><X className="w-3.5 h-3.5" /></button>
              <button onClick={handleEditSave} className="p-1 rounded-lg hover:bg-green-100 text-green-600"><Check className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ) : (
          <>
            <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
              isMine
                ? 'text-white rounded-br-md'
                : 'bg-white text-gray-900 border border-gray-100 rounded-bl-md'
            }`} style={isMine ? { backgroundColor: primaryColor } : {}}>

              {msg.type === 'text' && (
                <span className="whitespace-pre-wrap break-words">{msg.content}</span>
              )}

              {msg.type === 'image' && isSafeAttachmentUrl(msg.attachmentUrl) && (
                <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    src={msg.attachmentUrl}
                    alt="attachment"
                    className="rounded-xl max-w-[260px] max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  />
                </a>
              )}

              {msg.type === 'file' && isSafeAttachmentUrl(msg.attachmentUrl) && (
                <a
                  href={msg.attachmentUrl}
                  download={msg.attachmentName}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-2 hover:opacity-80 transition-opacity ${isMine ? 'text-white' : 'text-gray-800'}`}
                >
                  <div className={`p-2 rounded-lg ${isMine ? 'bg-white/20' : 'bg-gray-100'}`}>
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate max-w-[180px]">{msg.attachmentName || t('chat.file')}</p>
                    {msg.attachmentSize != null && (
                      <p className={`text-xs ${isMine ? 'text-white/70' : 'text-gray-500'}`}>{humanSize(msg.attachmentSize)}</p>
                    )}
                  </div>
                  <Download className="w-4 h-4 flex-shrink-0 ml-1" />
                </a>
              )}

              {msg.content && msg.type !== 'text' && (
                <p className="text-xs mt-1 whitespace-pre-wrap break-words">{msg.content}</p>
              )}
            </div>

            {/* Timestamp + edited */}
            <div className={`flex items-center gap-1 mt-0.5 px-1 ${isMine ? 'flex-row-reverse' : ''}`}>
              <span className="text-[10px] text-gray-400">{formatTime(msg.createdAt, t('common.yesterday'))}</span>
              {msg.editedAt && <span className="text-[10px] text-gray-400 italic">{t('chat.edited')}</span>}
            </div>
          </>
        )}
      </div>

      {/* Action buttons — only on mine + hover */}
      {isMine && !msg.isDeleted && !editMode && hovered && (
        <div className="flex gap-0.5 self-center opacity-0 group-hover:opacity-100 transition-opacity">
          {msg.type === 'text' && (
            <button
              onClick={() => { setEditVal(msg.content || ''); setEditMode(true); }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
              title={t('chat.edit')}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onDelete(msg.id)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
            title={t('chat.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
