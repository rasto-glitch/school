import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MasterHeader from '../components/MasterHeader';
import {
  listThreads,
  getEmail,
  patchEmail,
  patchThread,
  replyToEmail,
  composeEmail,
  getAttachmentUrl,
  ThreadSummary,
  EmailRow,
  InboxKey,
  InboxStatus,
} from '../api';
import type { MasterView } from '../App';

interface Props {
  onLogout: () => void;
  currentView: MasterView;
  onNavigate: (view: MasterView) => void;
}

const INBOXES: { key: InboxKey; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'support',    label: 'Support' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'contact',    label: 'Contact' },
  { key: 'partner',    label: 'Partner' },
];

const INBOX_ADDRS: { addr: string; label: string }[] = [
  { addr: 'support@scholify.krd',    label: 'Support' },
  { addr: 'onboarding@scholify.krd', label: 'Onboarding' },
  { addr: 'contact@scholify.krd',    label: 'Contact' },
  { addr: 'partner@scholify.krd',    label: 'Partner' },
];

const STATUSES: { key: InboxStatus; label: string }[] = [
  { key: 'all',      label: 'Active' },
  { key: 'unread',   label: 'Unread' },
  { key: 'archived', label: 'Archived' },
];

const MAX_FILES = 10;
const MAX_PER_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
};

const fmtFull = (iso: string) => new Date(iso).toLocaleString();

const fmtSize = (bytes: number | null | undefined): string => {
  if (typeof bytes !== 'number') return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const inboxLabel = (email: string) => {
  const local = email.split('@')[0];
  return INBOXES.find(i => i.key === local)?.label || email;
};

// Validate a batch of selected files against the limits. Returns either a
// human-readable error or a sanitized File[] list ready to attach.
const validateFiles = (incoming: FileList | File[], existing: File[]): { error: string } | { files: File[] } => {
  const arr = Array.from(incoming);
  const combined = [...existing, ...arr];
  if (combined.length > MAX_FILES) return { error: `Maximum ${MAX_FILES} files.` };
  for (const f of arr) {
    if (f.size > MAX_PER_FILE) return { error: `"${f.name}" exceeds ${MAX_PER_FILE / (1024 * 1024)} MB per file.` };
  }
  const total = combined.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL) return { error: `Attachments exceed ${MAX_TOTAL / (1024 * 1024)} MB total.` };
  return { files: combined };
};

export default function InboxPage({ onLogout, currentView, onNavigate }: Props) {
  const [inbox, setInbox] = useState<InboxKey>('all');
  const [status, setStatus] = useState<InboxStatus>('all');
  const [q, setQ] = useState('');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openEmail, setOpenEmail] = useState<EmailRow | null>(null);
  const [openThread, setOpenThread] = useState<EmailRow[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const [replyFrom, setReplyFrom] = useState<string>('support@scholify.krd');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);

  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await listThreads({ inbox, status, q: q.trim() || undefined });
      setThreads(r.data.threads || []);
      setError('');
    } catch {
      setError('Failed to load inbox.');
    } finally {
      setLoadingList(false);
    }
  }, [inbox, status, q]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll every 30s for new mail. Pause when a thread is open or composing.
  useEffect(() => {
    if (openId || composeOpen) return;
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [openId, composeOpen, refresh]);

  const openMessage = useCallback(async (latestId: string) => {
    setOpenId(latestId);
    setLoadingThread(true);
    setOpenEmail(null);
    setOpenThread([]);
    setReplyText('');
    setReplySubject('');
    setReplyCc('');
    setReplyFiles([]);
    setSendError('');
    try {
      const r = await getEmail(latestId);
      setOpenEmail(r.data.email);
      setOpenThread(r.data.thread);
      // Default the reply-from to the inbox the customer wrote to.
      setReplyFrom(r.data.email.to_email);
      const unread = r.data.thread.filter(t => t.direction === 'inbound' && !t.is_read);
      await Promise.all(unread.map(u => patchEmail(u.id, { isRead: true })));
      if (unread.length > 0) {
        setThreads(prev => prev.map(t => t.threadId === r.data.email.thread_id ? { ...t, unread: false } : t));
      }
    } catch {
      setSendError('Failed to load thread.');
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const closeMessage = () => {
    setOpenId(null);
    setOpenEmail(null);
    setOpenThread([]);
    setReplyFiles([]);
  };

  const toggleArchive = async () => {
    if (!openEmail) return;
    const next = !openEmail.is_archived;
    try {
      await patchThread(openEmail.thread_id, { isArchived: next });
      setThreads(prev => prev.filter(t => t.threadId !== openEmail.thread_id));
      closeMessage();
    } catch {
      setSendError('Failed to update.');
    }
  };

  const onPickReplyFiles = (filesIn: FileList | null) => {
    if (!filesIn) return;
    const result = validateFiles(filesIn, replyFiles);
    if ('error' in result) { setSendError(result.error); return; }
    setReplyFiles(result.files);
    setSendError('');
  };

  const sendReply = async () => {
    if (!openEmail || !replyText.trim()) return;
    setSending(true);
    setSendError('');
    try {
      const cc = replyCc
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
      await replyToEmail(
        openEmail.id,
        {
          text: replyText,
          subject: replySubject.trim() || undefined,
          cc: cc.length ? cc : undefined,
          fromInbox: replyFrom !== openEmail.to_email ? replyFrom : undefined,
        },
        replyFiles,
      );
      const r = await getEmail(openEmail.id);
      setOpenThread(r.data.thread);
      setReplyText('');
      setReplyCc('');
      setReplyFiles([]);
      setThreads(prev => prev.map(t =>
        t.threadId === openEmail.thread_id ? { ...t, replied: true, latestDirection: 'outbound', latestAt: new Date().toISOString() } : t
      ));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSendError(e?.response?.data?.error || 'Failed to send reply.');
    } finally {
      setSending(false);
    }
  };

  const composeDefaultFrom = useMemo(() => {
    if (inbox === 'all') return 'support@scholify.krd';
    return `${inbox}@scholify.krd`;
  }, [inbox]);

  const unreadCount = useMemo(() => threads.filter(t => t.unread).length, [threads]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <MasterHeader currentView={currentView} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="border-b border-slate-200 bg-white px-6 py-3 flex items-center gap-4">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {INBOXES.map(i => (
            <button
              key={i.key}
              onClick={() => setInbox(i.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                inbox === i.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {STATUSES.map(s => (
            <button
              key={s.key}
              onClick={() => setStatus(s.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                status === s.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search subject, body, sender…"
          className="flex-1 max-w-md px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
        />

        <span className="text-xs text-slate-500">
          {loadingList ? 'Loading…' : `${threads.length} thread${threads.length === 1 ? '' : 's'}${unreadCount ? `, ${unreadCount} unread` : ''}`}
        </span>

        <button
          onClick={() => setComposeOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Compose
        </button>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex-1 flex overflow-hidden">
        {/* List pane */}
        <div className="w-96 border-r border-slate-200 bg-white overflow-y-auto">
          {threads.length === 0 && !loadingList && (
            <div className="p-8 text-center text-sm text-slate-400">No messages.</div>
          )}
          {threads.map(t => (
            <button
              key={t.threadId}
              onClick={() => openMessage(t.latestId)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                openEmail?.thread_id === t.threadId ? 'bg-indigo-50' : ''
              }`}
            >
              <div className="flex items-start gap-2">
                {t.unread && <span className="mt-1.5 w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className={`text-sm truncate ${t.unread ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                      {t.participant.name || t.participant.email}
                    </div>
                    <div className="text-xs text-slate-400 shrink-0">{fmtTime(t.latestAt)}</div>
                  </div>
                  <div className={`text-sm truncate ${t.unread ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
                    {t.subject}
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-0.5">{t.preview}</div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-slate-100 text-slate-600 rounded">
                      {inboxLabel(t.inbox)}
                    </span>
                    {t.messageCount > 1 && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded">
                        {t.messageCount} msgs
                      </span>
                    )}
                    {t.replied && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded">replied</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Detail pane */}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          {!openId && (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              Select a message to read.
            </div>
          )}

          {openId && loadingThread && (
            <div className="p-8 text-sm text-slate-400">Loading thread…</div>
          )}

          {openEmail && !loadingThread && (
            <div className="max-w-3xl mx-auto p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{openEmail.subject || '(no subject)'}</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    {inboxLabel(openEmail.to_email)} inbox · {openThread.length} message{openThread.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={toggleArchive}
                    className="text-xs text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 px-3 py-1.5 rounded-md transition-colors"
                  >
                    {openEmail.is_archived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button
                    onClick={closeMessage}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {openThread.map(m => <MessageCard key={m.id} m={m} />)}
              </div>

              {/* Reply box */}
              <div className="mt-4 bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                  <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <span>Reply from</span>
                    <select
                      value={replyFrom}
                      onChange={e => setReplyFrom(e.target.value)}
                      className="text-sm border border-slate-300 rounded-md px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    >
                      {INBOX_ADDRS.map(i => (
                        <option key={i.addr} value={i.addr}>{i.label} ({i.addr})</option>
                      ))}
                    </select>
                    <span className="text-slate-500">→ {openEmail.from_email}</span>
                  </div>
                </div>
                <input
                  value={replySubject}
                  onChange={e => setReplySubject(e.target.value)}
                  placeholder={openEmail.subject?.startsWith('Re:') ? openEmail.subject : `Re: ${openEmail.subject || ''}`}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md mb-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
                <input
                  value={replyCc}
                  onChange={e => setReplyCc(e.target.value)}
                  placeholder="cc (optional, comma-separated)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md mb-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type your reply…"
                  rows={8}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-sans focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />

                <FileChips
                  files={replyFiles}
                  onRemove={i => setReplyFiles(prev => prev.filter((_, idx) => idx !== i))}
                />

                {sendError && <div className="mt-2 text-xs text-red-600">{sendError}</div>}
                <div className="flex items-center justify-between gap-2 mt-3">
                  <FilePicker onPick={onPickReplyFiles} />
                  <button
                    onClick={sendReply}
                    disabled={sending || !replyText.trim()}
                    className="px-4 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {sending ? 'Sending…' : 'Send reply'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {composeOpen && (
        <ComposeModal
          defaultFrom={composeDefaultFrom}
          onClose={() => setComposeOpen(false)}
          onSent={() => { setComposeOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────────────

function MessageCard({ m }: { m: EmailRow }) {
  const [showHtml, setShowHtml] = useState(false);
  const hasHtml = !!(m.html_body && m.html_body.trim());
  const hasText = !!(m.text_body && m.text_body.trim());

  const openAttachment = async (idx: number) => {
    try {
      const r = await getAttachmentUrl(m.id, idx);
      window.open(r.data.url, '_blank', 'noopener');
    } catch {
      // No stored file — show a brief inline error via alert as fallback.
      alert('This attachment was not stored. Check your Gmail mirror.');
    }
  };

  return (
    <article
      className={`bg-white border rounded-lg p-4 ${
        m.direction === 'outbound' ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200'
      }`}
    >
      <header className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm min-w-0">
          {m.from_name && m.from_name !== m.from_email ? (
            <>
              <span className="font-medium text-slate-900">{m.from_name}</span>
              <span className="text-slate-400"> &lt;{m.from_email}&gt;</span>
            </>
          ) : (
            <span className="font-medium text-slate-900">{m.from_email}</span>
          )}
          <span className="text-slate-400"> → {m.to_email}</span>
        </div>
        <time className="text-xs text-slate-400 shrink-0" title={fmtFull(m.received_at)}>
          {fmtFull(m.received_at)}
        </time>
      </header>

      {m.cc_emails.length > 0 && (
        <div className="text-xs text-slate-500 mb-2">cc: {m.cc_emails.join(', ')}</div>
      )}

      {showHtml && hasHtml ? (
        <iframe
          sandbox=""
          srcDoc={m.html_body || ''}
          className="w-full border border-slate-200 rounded bg-white"
          style={{ height: 460 }}
          title="email-html"
        />
      ) : (
        <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed m-0">
          {hasText
            ? m.text_body
            : hasHtml
              ? '(no plain-text version — click View HTML)'
              : '(empty)'}
        </pre>
      )}

      {m.attachments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
          {m.attachments.map((a, idx) => {
            const stored = !!a.storageKey;
            return (
              <button
                key={idx}
                onClick={() => stored && openAttachment(idx)}
                disabled={!stored}
                title={stored ? 'Download' : 'Not stored — check your Gmail mirror'}
                className={`inline-flex items-center gap-2 px-2 py-1 text-xs border rounded-md transition-colors ${
                  stored
                    ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                    : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                <span className="truncate max-w-[180px]">{a.name || `file-${idx}`}</span>
                {typeof a.size === 'number' && <span className="text-slate-400">{fmtSize(a.size)}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-3 text-xs">
        {hasHtml && hasText && (
          <button
            onClick={() => setShowHtml(s => !s)}
            className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline shrink-0"
          >
            {showHtml ? 'View text' : 'View HTML'}
          </button>
        )}
        {hasHtml && !hasText && !showHtml && (
          <button
            onClick={() => setShowHtml(true)}
            className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline shrink-0"
          >
            View HTML
          </button>
        )}
      </div>
    </article>
  );
}

function FilePicker({ onPick }: { onPick: (files: FileList | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          onPick(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 hover:border-slate-400 hover:text-slate-900 rounded-md transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
        Attach files
      </button>
    </>
  );
}

function FileChips({ files, onRemove }: { files: File[]; onRemove: (idx: number) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f, idx) => (
        <span
          key={`${f.name}-${idx}`}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-md"
        >
          <span className="truncate max-w-[200px]">{f.name}</span>
          <span className="text-slate-400">{fmtSize(f.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="text-slate-400 hover:text-slate-700"
            title="Remove"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );
}

function ComposeModal({
  defaultFrom,
  onClose,
  onSent,
}: {
  defaultFrom: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const onPick = (filesIn: FileList | null) => {
    if (!filesIn) return;
    const result = validateFiles(filesIn, files);
    if ('error' in result) { setError(result.error); return; }
    setFiles(result.files);
    setError('');
  };

  const canSend = !!to.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) && !!subject.trim() && !!text.trim() && !sending;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setError('');
    try {
      const ccList = cc
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
      await composeEmail(
        {
          from,
          to: to.trim(),
          subject: subject.trim(),
          text,
          cc: ccList.length ? ccList : undefined,
        },
        files,
      );
      onSent();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || 'Failed to send.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">New message</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 w-16">From</label>
            <select
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            >
              {INBOX_ADDRS.map(i => (
                <option key={i.addr} value={i.addr}>{i.label} ({i.addr})</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 w-16">To</label>
            <input
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 w-16">Cc</label>
            <input
              value={cc}
              onChange={e => setCc(e.target.value)}
              placeholder="optional, comma-separated"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 w-16">Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Write your message…"
            rows={10}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-sans focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />

          <FileChips files={files} onRemove={i => setFiles(prev => prev.filter((_, idx) => idx !== i))} />

          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <FilePicker onPick={onPick} />
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSend}
              className="px-4 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
