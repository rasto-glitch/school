import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { feesApi, drainPages, type ArchiveListItem, type ArchiveDetail } from '../../services/api';
import { toast } from 'react-toastify';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import Modal from '../../components/common/Modal';
import { Archive, Search, FileSpreadsheet, FileText, GraduationCap } from 'lucide-react';
import { fmtMoney as fmt } from '../../utils/money';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFile(s: string) {
  return s.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'student';
}

export default function TuitionArchiveTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ArchiveListItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'archived' | 'graduated'>('all');
  const [detailFor, setDetailFor] = useState<ArchiveListItem | null>(null);
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  useEffect(() => {
    // Backend is keyset-paginated; drain to the full set so the existing
    // client-side search/filter keeps working unchanged.
    drainPages<ArchiveListItem>(c => feesApi.listArchive(undefined, c))
      .then(setItems)
      .catch((e: any) => toast.error(e.response?.data?.error || t('accounting.archive.load_failed')));
  }, []);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = search.trim().toLowerCase();
    let arr = items;
    if (filter !== 'all') arr = arr.filter(i => i.kind === filter);
    if (q) arr = arr.filter(i =>
      i.fullName.toLowerCase().includes(q)
      || (i.parentName ?? '').toLowerCase().includes(q)
      || (i.className ?? '').toLowerCase().includes(q),
    );
    return arr;
  }, [items, search, filter]);

  const openDetail = async (item: ArchiveListItem) => {
    setDetailFor(item);
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await feesApi.getArchiveDetail(item.kind, item.id);
      setDetail(r.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.archive.load_record_failed'));
      setDetailFor(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailFor(null);
    setDetail(null);
  };

  const exportFile = async (kind: 'pdf' | 'xlsx') => {
    if (!detailFor || !detail) return;
    setExporting(kind);
    try {
      const r = kind === 'pdf'
        ? await feesApi.downloadArchivePdf(detailFor.kind, detailFor.id)
        : await feesApi.downloadArchiveXlsx(detailFor.kind, detailFor.id);
      downloadBlob(r.data, `payments-${safeFile(detail.studentName)}.${kind}`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.archive.export_failed', { format: kind.toUpperCase() }));
    } finally {
      setExporting(null);
    }
  };

  if (items === null) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1 max-w-sm">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('accounting.tuition.search_ph')}
            icon={<Search className="w-4 h-4 text-gray-400" />}
          />
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {(['all', 'archived', 'graduated'] as const).map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filter === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {k === 'all' ? t('accounting.tuition.all') : k === 'archived' ? t('accounting.archive.f_archived') : t('accounting.archive.f_graduated')}
            </button>
          ))}
        </div>
      </div>

      {filtered && filtered.length === 0 ? (
        <EmptyState
          icon={<Archive className="w-10 h-10 text-gray-400" />}
          title={t('accounting.archive.none_title')}
          description={t('accounting.archive.none_desc')}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t('accounting.archive.col_student')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('accounting.archive.col_status')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('accounting.archive.col_parent')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('accounting.archive.col_class')}</th>
                  <th className="text-right px-4 py-3 font-medium">{t('accounting.archive.col_total_paid')}</th>
                  <th className="text-right px-4 py-3 font-medium">{t('accounting.archive.col_balance')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered?.map(item => (
                  <tr key={`${item.kind}:${item.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.fullName}</td>
                    <td className="px-4 py-3">
                      {item.kind === 'archived' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          <Archive className="w-3 h-3" /> {t('accounting.archive.f_archived')}{item.date ? ` · ${item.date}` : ''}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                          <GraduationCap className="w-3 h-3" /> {t('accounting.archive.f_graduated')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.parentName ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.className ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{fmt(item.totalPaid, item.currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={item.balance > 0 ? 'text-rose-600 font-medium' : 'text-gray-500'}>
                        {fmt(item.balance, item.currency)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openDetail(item)}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        {t('accounting.archive.view')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={!!detailFor} onClose={closeDetail} title={detail?.studentName ?? t('accounting.archive.payment_history')} size="lg">
        {detailLoading || !detail ? (
          <LoadingSpinner />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wide">{t('accounting.archive.col_status')}</div>
                <div className="text-gray-900 font-medium">
                  {detail.status === 'archived' ? t('accounting.archive.f_archived') : t('accounting.archive.f_graduated')}
                  {detail.departureDate ? ` · ${detail.departureDate}` : ''}
                  {detail.reason ? ` · ${detail.reason}` : ''}
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wide">{t('accounting.archive.col_parent')}</div>
                <div className="text-gray-900 font-medium">
                  {detail.parentName ?? '—'}{detail.parentPhone ? ` · ${detail.parentPhone}` : ''}
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wide">{t('accounting.archive.last_class')}</div>
                <div className="text-gray-900 font-medium">{detail.className ?? '—'}</div>
              </div>
            </div>

            {detail.plans.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-600">
                {t('accounting.archive.no_plans')}
              </div>
            ) : (
              <div className="space-y-4">
                {detail.plans.map((plan, idx) => {
                  const due = plan.totalAmount + plan.adjustment;
                  const paid = plan.payments.reduce((s, p) => s + p.amount, 0);
                  const balance = Math.max(0, due - paid);
                  return (
                    <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="font-medium text-gray-900">
                            {plan.planName}{plan.academicYear ? ` · ${plan.academicYear}` : ''}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {t('accounting.archive.tuition')} {fmt(plan.totalAmount, plan.currency)}
                            {plan.adjustment !== 0 ? ` · ${t('accounting.archive.adjustment')} ${fmt(plan.adjustment, plan.currency)}` : ''}
                            {' · '}{t('accounting.archive.due')} {fmt(due, plan.currency)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-700">{t('accounting.archive.paid')} {fmt(paid, plan.currency)}</div>
                          <div className={`text-sm font-medium ${balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {balance > 0 ? t('accounting.archive.balance_amount', { amount: fmt(balance, plan.currency) }) : t('accounting.tuition.paid_in_full')}
                          </div>
                        </div>
                      </div>
                      {plan.payments.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-gray-500">{t('accounting.archive.no_payments')}</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-white text-gray-500">
                            <tr>
                              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide">{t('accounting.archive.col_date')}</th>
                              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide">{t('accounting.archive.col_method')}</th>
                              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide">{t('accounting.archive.col_reference')}</th>
                              <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide">{t('accounting.archive.col_amount')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {plan.payments.map((p, pIdx) => (
                              <tr key={pIdx}>
                                <td className="px-4 py-2 text-gray-900">{p.paidOn}</td>
                                <td className="px-4 py-2 text-gray-700">{p.method ? p.method[0].toUpperCase() + p.method.slice(1) : '—'}</td>
                                <td className="px-4 py-2 text-gray-700">{p.reference || '—'}</td>
                                <td className="px-4 py-2 text-right text-gray-900">{fmt(p.amount, plan.currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <button
                onClick={() => exportFile('xlsx')}
                disabled={exporting !== null}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4" />
                {exporting === 'xlsx' ? t('accounting.archive.exporting') : t('accounting.archive.excel')}
              </button>
              <button
                onClick={() => exportFile('pdf')}
                disabled={exporting !== null}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                {exporting === 'pdf' ? t('accounting.archive.exporting') : t('accounting.archive.pdf')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
