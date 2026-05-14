import { useCallback, useEffect, useMemo, useState } from 'react';
import MasterHeader from '../components/MasterHeader';
import {
  listThreads,
  getEmail,
  patchEmail,
  patchThread,
  replyToEmail,
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

const STATUSES: { key: InboxStatus; label: string }[] = [
  { key: 'all',      label: 'Active' },
  { key: 'unread',   label: 'Unread' },
  { key: 'archived', label: 'Archived' },
];

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
};

const fmtFull = (iso: string) => new Date(iso).toLocaleString();

const inboxLabel = (email: string) => {
  const local = email.split('@')[0];
  return INBOXES.find(i => i.key === local)?.label || email;
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

  const [replyText, setReplyText] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

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

  // Poll every 30s for new mail. Pause when a thread is open (operator is
  // probably composing); resume on close.
  useEffect(() => {
    if (openId) return;
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [openId, refresh]);

  const openMessage = useCallback(async (latestId: string) => {
    setOpenId(latestId);
    setLoadingThread(true);
    setOpenEmail(null);
    setOpenThread([]);
    setReplyText('');
    setReplySubject('');
    setReplyCc('');
    setSendError('');
    try {
      const r = await getEmail(latestId);
      setOpenEmail(r.data.email);
      setOpenThread(r.data.thread);
      // Mark unread inbound messages as read.
      const unread = r.data.thread.filter(t => t.direction === 'inbound' && !t.is_read);
      await Promise.all(unread.map(u => patchEmail(u.id, { isRead: true })));
      if (unread.length > 0) {
        // Local optimistic update
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

  const sendReply = async () => {
    if (!openEmail || !replyText.trim()) return;
    setSending(true);
    setSendError('');
    try {
      const cc = replyCc
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
      await replyToEmail(openEmail.id, {
        text: replyText,
        subject: replySubject.trim() || undefined,
        cc: cc.length ? cc : undefined,
      });
      // Reload the thread so the new outbound row shows immediately.
      const r = await getEmail(openEmail.id);
      setOpenThread(r.data.thread);
      setReplyText('');
      setReplyCc('');
      // Update list summary
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
                {openThread.map(m => (
                  <article
                    key={m.id}
                    className={`bg-white border rounded-lg p-4 ${
                      m.direction === 'outbound' ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200'
                    }`}
                  >
                    <header className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-sm">
                        <span className="font-medium text-slate-900">{m.from_name || m.from_email}</span>
                        <span className="text-slate-400"> &lt;{m.from_email}&gt;</span>
                        <span className="text-slate-400"> → {m.to_email}</span>
                      </div>
                      <time className="text-xs text-slate-400" title={fmtFull(m.received_at)}>
                        {fmtFull(m.received_at)}
                      </time>
                    </header>
                    {m.cc_emails.length > 0 && (
                      <div className="text-xs text-slate-500 mb-2">cc: {m.cc_emails.join(', ')}</div>
                    )}
                    <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                      {m.text_body || (m.html_body ? '(HTML only — see source)' : '(empty)')}
                    </pre>
                    {m.attachments.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                        Attachments: {m.attachments.map(a => a.name).filter(Boolean).join(', ')}
                        <span className="text-slate-400"> (kept in Gmail, not stored here)</span>
                      </div>
                    )}
                  </article>
                ))}
              </div>

              {/* Reply box */}
              <div className="mt-4 bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-slate-700">
                    Reply as <span className="text-slate-900">{openEmail.to_email}</span> → {openEmail.from_email}
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
                {sendError && <div className="mt-2 text-xs text-red-600">{sendError}</div>}
                <div className="flex items-center justify-end gap-2 mt-3">
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
    </div>
  );
}
