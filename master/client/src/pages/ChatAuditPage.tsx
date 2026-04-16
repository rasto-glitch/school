import { useCallback, useEffect, useState } from 'react';
import {
  getSchools,
  getAuditConversations,
  getAuditMessages,
  exportAuditConversation,
  getAccessLog,
  School,
  AuditConversation,
  AuditMessage,
  AccessLogEntry,
} from '../api';
import MasterHeader from '../components/MasterHeader';
import type { MasterView } from '../App';

interface Props {
  onLogout: () => void;
  currentView: MasterView;
  onNavigate: (view: MasterView) => void;
}

type SubTab = 'conversations' | 'access-log';

export default function ChatAuditPage({ onLogout, currentView, onNavigate }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('conversations');
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [conversations, setConversations] = useState<AuditConversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);

  const [pendingAction, setPendingAction] = useState<{ type: 'view' | 'export'; conversation: AuditConversation } | null>(null);
  const [reason, setReason] = useState('');
  const [submittingReason, setSubmittingReason] = useState(false);

  const [openConversation, setOpenConversation] = useState<AuditConversation | null>(null);
  const [messages, setMessages] = useState<AuditMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [accessLog, setAccessLog] = useState<AccessLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => {
    getSchools().then(r => {
      setSchools(r.data);
      if (r.data.length > 0 && !selectedSchoolId) setSelectedSchoolId(r.data[0].id);
    }).catch(() => setError('Failed to load schools.'));
  }, []);

  const loadConversations = useCallback(async (schoolId: string) => {
    setLoadingConvs(true);
    setError('');
    try {
      const r = await getAuditConversations(schoolId);
      setConversations(r.data);
    } catch {
      setError('Failed to load conversations.');
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSchoolId && subTab === 'conversations') loadConversations(selectedSchoolId);
  }, [selectedSchoolId, subTab, loadConversations]);

  const loadAccessLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const r = await getAccessLog(selectedSchoolId || undefined);
      setAccessLog(r.data);
    } catch {
      setError('Failed to load access log.');
    } finally {
      setLoadingLog(false);
    }
  }, [selectedSchoolId]);

  useEffect(() => {
    if (subTab === 'access-log') loadAccessLog();
  }, [subTab, selectedSchoolId, loadAccessLog]);

  const openReasonPrompt = (type: 'view' | 'export', conversation: AuditConversation) => {
    setPendingAction({ type, conversation });
    setReason('');
  };

  const confirmReason = async () => {
    if (!pendingAction) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Please provide a reason of at least 3 characters.');
      return;
    }
    setSubmittingReason(true);
    setError('');
    try {
      if (pendingAction.type === 'view') {
        const r = await getAuditMessages(pendingAction.conversation.id, trimmed);
        setMessages(r.data.messages);
        setOpenConversation(pendingAction.conversation);
      } else {
        const r = await exportAuditConversation(pendingAction.conversation.id, trimmed);
        const blob = new Blob([r.data], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-${pendingAction.conversation.id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setPendingAction(null);
      setReason('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Request failed.';
      setError(msg);
    } finally {
      setSubmittingReason(false);
    }
  };

  const closeViewer = () => {
    setOpenConversation(null);
    setMessages([]);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <MasterHeader currentView={currentView} onNavigate={onNavigate} onLogout={onLogout} />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Chat Audit</h2>
            <p className="text-sm text-slate-500 mt-1">Privileged review of parent–staff conversations. Every access is logged with a reason.</p>
          </div>
        </div>

        {/* School picker + sub-tabs */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 font-medium">School:</label>
            <select
              value={selectedSchoolId}
              onChange={e => setSelectedSchoolId(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {schools.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 ml-auto">
            <button
              onClick={() => setSubTab('conversations')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                subTab === 'conversations' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Conversations
            </button>
            <button
              onClick={() => setSubTab('access-log')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                subTab === 'access-log' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Access Log
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>
        )}

        {subTab === 'conversations' && (
          <ConversationsList
            loading={loadingConvs}
            conversations={conversations}
            onView={c => openReasonPrompt('view', c)}
            onExport={c => openReasonPrompt('export', c)}
          />
        )}

        {subTab === 'access-log' && (
          <AccessLogList loading={loadingLog} entries={accessLog} schools={schools} />
        )}
      </main>

      {pendingAction && (
        <ReasonModal
          action={pendingAction.type}
          conversation={pendingAction.conversation}
          reason={reason}
          setReason={setReason}
          submitting={submittingReason}
          onCancel={() => { setPendingAction(null); setReason(''); }}
          onConfirm={confirmReason}
        />
      )}

      {openConversation && (
        <MessageViewer
          conversation={openConversation}
          messages={messages}
          loading={loadingMessages}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}

// ── Conversation list ─────────────────────────────────────────────────────

function ConversationsList({ loading, conversations, onView, onExport }: {
  loading: boolean;
  conversations: AuditConversation[];
  onView: (c: AuditConversation) => void;
  onExport: (c: AuditConversation) => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (conversations.length === 0) {
    return <div className="text-center py-20 text-slate-400 text-sm">No conversations in this school.</div>;
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>Parent</Th>
            <Th>Staff</Th>
            <Th>Messages</Th>
            <Th>Last activity</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {conversations.map(c => (
            <tr key={c.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
              <Td>{c.parent ? `${c.parent.firstName} ${c.parent.lastName}` : <em className="text-slate-400">(missing)</em>}</Td>
              <Td>
                {c.staff ? `${c.staff.firstName} ${c.staff.lastName}` : <em className="text-slate-400">(missing)</em>}
                <span className="ml-2 text-xs text-slate-400 capitalize">{c.staffRole}</span>
              </Td>
              <Td>{c.messageCount}</Td>
              <Td className="text-slate-500">{c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : '—'}</Td>
              <Td className="text-right">
                <button
                  onClick={() => onView(c)}
                  className="text-indigo-600 hover:text-indigo-500 font-medium mr-3"
                >
                  View
                </button>
                <button
                  onClick={() => onExport(c)}
                  className="text-slate-500 hover:text-slate-800 font-medium"
                >
                  Export CSV
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Access log list ───────────────────────────────────────────────────────

function AccessLogList({ loading, entries, schools }: { loading: boolean; entries: AccessLogEntry[]; schools: School[] }) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (entries.length === 0) {
    return <div className="text-center py-20 text-slate-400 text-sm">No audit-access entries yet.</div>;
  }
  const schoolMap: Record<string, string> = {};
  schools.forEach(s => { schoolMap[s.id] = s.name; });
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>When</Th>
            <Th>School</Th>
            <Th>Action</Th>
            <Th>Conversation</Th>
            <Th>Reason</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} className="border-b border-slate-100 last:border-b-0">
              <Td className="text-slate-500 whitespace-nowrap">{new Date(e.accessed_at).toLocaleString()}</Td>
              <Td>{schoolMap[e.school_id] || <em className="text-slate-400">{e.school_id}</em>}</Td>
              <Td>
                <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${
                  e.action === 'export' ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'
                }`}>{e.action}</span>
              </Td>
              <Td className="font-mono text-xs text-slate-500">{e.conversation_id ?? '—'}</Td>
              <Td>{e.reason}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Reason modal ─────────────────────────────────────────────────────────

function ReasonModal({ action, conversation, reason, setReason, submitting, onCancel, onConfirm }: {
  action: 'view' | 'export';
  conversation: AuditConversation;
  reason: string;
  setReason: (r: string) => void;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const parentName = conversation.parent ? `${conversation.parent.firstName} ${conversation.parent.lastName}` : '(missing)';
  const staffName = conversation.staff ? `${conversation.staff.firstName} ${conversation.staff.lastName}` : '(missing)';
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="font-bold text-slate-900 text-lg mb-1">
          {action === 'view' ? 'Review conversation' : 'Export conversation'}
        </h3>
        <p className="text-sm text-slate-500 mb-4">
          Between <strong>{parentName}</strong> and <strong>{staffName}</strong>.
        </p>
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3 mb-4">
          This access will be logged with the reason below. Use only for a legal or safeguarding request.
        </div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Reason</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Court order #2026-04-12, ref. School admin request"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm min-h-[96px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? 'Working…' : action === 'view' ? 'Open & log access' : 'Export & log access'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Message viewer ───────────────────────────────────────────────────────

function MessageViewer({ conversation, messages, loading, onClose }: {
  conversation: AuditConversation;
  messages: AuditMessage[];
  loading: boolean;
  onClose: () => void;
}) {
  const parentName = conversation.parent ? `${conversation.parent.firstName} ${conversation.parent.lastName}` : '(missing)';
  const staffName = conversation.staff ? `${conversation.staff.firstName} ${conversation.staff.lastName}` : '(missing)';
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900">{parentName} ↔ {staffName}</h3>
            <p className="text-xs text-slate-500 mt-0.5 capitalize">{conversation.staffRole} · {messages.length} messages</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {loading && <div className="text-center py-8 text-slate-400">Loading…</div>}
          {!loading && messages.length === 0 && <div className="text-center py-8 text-slate-400">No messages.</div>}
          {messages.map(m => (
            <MessageRow key={m.id} message={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: AuditMessage }) {
  const name = message.sender ? `${message.sender.firstName} ${message.sender.lastName}` : '(unknown)';
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-sm font-medium text-slate-800">
          {name}
          <span className="ml-2 text-xs text-slate-400 capitalize">{message.sender?.role}</span>
        </div>
        <div className="text-xs text-slate-400">{new Date(message.createdAt).toLocaleString()}</div>
      </div>

      {message.isDeleted ? (
        <div className="text-sm">
          <span className="inline-block text-xs font-medium px-2 py-0.5 rounded bg-red-50 text-red-700 mr-2">deleted</span>
          {message.deletedContent ? (
            <span className="text-slate-700">{message.deletedContent}</span>
          ) : (
            <em className="text-slate-400">(empty)</em>
          )}
          {message.deletedAttachmentName && (
            <div className="mt-1 text-xs text-slate-500">
              Attachment at time of delete: <span className="font-medium">{message.deletedAttachmentName}</span>
              {message.deletedAttachmentUrl && (
                <> — <a href={message.deletedAttachmentUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">open</a></>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
          {message.content ?? <em className="text-slate-400">(empty)</em>}
        </div>
      )}

      {message.type !== 'text' && message.attachmentUrl && !message.isDeleted && (
        <div className="mt-2 text-xs text-slate-500">
          Attachment: <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
            {message.attachmentName || message.attachmentUrl}
          </a>
        </div>
      )}

      {message.editedAt && (
        <div className="mt-2 text-xs text-amber-700">
          Edited at {new Date(message.editedAt).toLocaleString()}
        </div>
      )}

      {message.edits.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-800">
            Prior versions ({message.edits.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {message.edits.map((e, i) => (
              <div key={i} className="bg-amber-50 border border-amber-100 rounded p-2 text-xs">
                <div className="text-amber-700 font-medium mb-0.5">{new Date(e.editedAt).toLocaleString()}</div>
                <div className="text-slate-700 whitespace-pre-wrap break-words">
                  {e.previousContent ?? <em className="text-slate-400">(empty)</em>}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left font-semibold text-slate-600 text-xs uppercase tracking-wide px-4 py-3 ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-slate-800 ${className}`}>{children}</td>;
}
