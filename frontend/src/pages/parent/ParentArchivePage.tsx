import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, GraduationCap, ChevronLeft } from 'lucide-react';
import { parentApi } from '../../services/api';
import { fmtMoney } from '../../utils/money';
import { collectMarkNames, getMarkValue, gradeTotal, type GradeLike } from '../../utils/marks';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

interface ArchivedChildSummary {
  id: string;
  fullName: string;
  reason: string;
  departureDate: string | null;
  classesAttended?: { year: string; classId: string; className: string }[];
  createdAt: string;
}

interface SnapshotGrade extends GradeLike {
  academicYear: string | null;
  gradingPeriod: string | null;
  subject: string | null;
  className: string | null;
}

interface SnapshotPayment {
  amount: number; paidOn: string; method: string | null; reference: string | null;
  notes: string | null; currency: string | null; receiptYear: number | null; receiptNumber: number | null;
}
interface SnapshotPlan {
  planName: string; academicYear: string | null; currency: string;
  totalAmount: number; adjustment: number; siblingDiscount: number; lateFees: number;
  notes: string | null; payments: SnapshotPayment[];
}
interface ArchivedChildDetail extends ArchivedChildSummary {
  dateOfBirth: string | null;
  enrollmentDate: string | null;
  grades: SnapshotGrade[];
  paymentHistory: SnapshotPlan[];
}

function receiptNo(p: SnapshotPayment): string | null {
  if (!p.receiptYear || !p.receiptNumber) return null;
  return `RCP-${p.receiptYear}-${String(p.receiptNumber).padStart(5, '0')}`;
}

export default function ParentArchivePage() {
  const { t } = useTranslation();
  const reasonLabel = (reason: string) => t(`archive.reason.${reason}`, { defaultValue: reason });
  const [list, setList] = useState<ArchivedChildSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArchivedChildDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    parentApi.getArchivedChildren()
      .then(r => setList((r.data || []) as ArchivedChildSummary[]))
      .catch(() => setList([]));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    parentApi.getArchivedChild(selectedId)
      .then(r => setDetail(r.data as ArchivedChildDetail))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  // Group grades: academicYear → gradingPeriod → grades[]
  const grouped = useMemo(() => {
    const out = new Map<string, Map<string, SnapshotGrade[]>>();
    for (const g of detail?.grades ?? []) {
      const yr = g.academicYear || '—';
      const term = g.gradingPeriod || '—';
      if (!out.has(yr)) out.set(yr, new Map());
      const byTerm = out.get(yr)!;
      if (!byTerm.has(term)) byTerm.set(term, []);
      byTerm.get(term)!.push(g);
    }
    return out;
  }, [detail]);

  if (list === null) {
    return <PageLayout title={t('archive.title')}><LoadingSpinner /></PageLayout>;
  }

  if (list.length === 0) {
    return (
      <PageLayout title={t('archive.title')} subtitle={t('archive.subtitle')}>
        <EmptyState
          title={t('archive.no_records_title')}
          description={t('archive.no_records_desc')}
          icon={<Archive className="w-8 h-8 text-gray-400" />}
        />
      </PageLayout>
    );
  }

  // Detail view
  if (selectedId && detail) {
    return (
      <PageLayout title={detail.fullName} subtitle={`${reasonLabel(detail.reason)}${detail.departureDate ? ` · ${detail.departureDate}` : ''}`}>
        <button onClick={() => setSelectedId(null)} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4">
          <ChevronLeft className="w-4 h-4" /> {t('archive.back_to_all')}
        </button>

        {detailLoading ? <LoadingSpinner /> : (
          <div className="space-y-6">
            {/* Classes attended */}
            {detail.classesAttended && detail.classesAttended.length > 0 && (
              <Card>
                <h2 className="font-semibold text-gray-900 mb-3">{t('archive.classes_attended')}</h2>
                <div className="flex flex-wrap gap-2">
                  {detail.classesAttended.map((c, i) => (
                    <span key={i} className="text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1">
                      {c.year}: {c.className}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* Grades report */}
            <Card>
              <h2 className="font-semibold text-gray-900 mb-3">{t('archive.grades')}</h2>
              {grouped.size === 0 ? (
                <p className="text-sm text-gray-500">{t('archive.no_grades')}</p>
              ) : (
                <div className="space-y-6">
                  {Array.from(grouped.entries()).map(([year, byTerm]) => (
                    <div key={year}>
                      <h3 className="text-sm font-bold text-gray-800 mb-2">{year}</h3>
                      <div className="space-y-4">
                        {Array.from(byTerm.entries()).map(([term, grades]) => {
                          const markNames = collectMarkNames(grades);
                          return (
                            <div key={term} className="border border-gray-200 rounded-xl overflow-hidden">
                              <div className="bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-700">{term}</div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-gray-500 border-b border-gray-200">
                                      <th className="px-4 py-2 font-medium">{t('common.subject')}</th>
                                      {markNames.map(n => <th key={n} className="px-3 py-2 font-medium text-center">{n}</th>)}
                                      <th className="px-3 py-2 font-medium text-center">{t('common.total')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {grades.map((g, i) => (
                                      <tr key={i} className="border-b border-gray-100 last:border-0">
                                        <td className="px-4 py-2 text-gray-900">{g.subject || '—'}</td>
                                        {markNames.map(n => {
                                          const v = getMarkValue(g, n);
                                          return <td key={n} className="px-3 py-2 text-center text-gray-700">{v ?? '—'}</td>;
                                        })}
                                        <td className="px-3 py-2 text-center font-semibold text-gray-900">{gradeTotal(g, markNames)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Tuition / payment history */}
            <Card>
              <h2 className="font-semibold text-gray-900 mb-3">{t('archive.tuition_history')}</h2>
              {(detail.paymentHistory ?? []).length === 0 ? (
                <p className="text-sm text-gray-500">{t('archive.no_tuition')}</p>
              ) : (
                <div className="space-y-4">
                  {detail.paymentHistory.map((plan, i) => {
                    const paid = plan.payments.reduce((s, p) => s + p.amount, 0);
                    const due = plan.totalAmount + plan.adjustment + plan.lateFees - plan.siblingDiscount;
                    return (
                      <div key={i} className="border border-gray-200 rounded-xl p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                          <div className="font-semibold text-gray-900">{plan.planName}{plan.academicYear ? ` · ${plan.academicYear}` : ''}</div>
                          <div className="text-sm text-gray-600">
                            {t('archive.paid_amount', { paid: fmtMoney(paid, plan.currency), due: fmtMoney(due, plan.currency) })}
                          </div>
                        </div>
                        {plan.payments.length > 0 && (
                          <div className="space-y-1">
                            {plan.payments.map((p, j) => {
                              const rcp = receiptNo(p);
                              return (
                                <div key={j} className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5">
                                  <span>{p.paidOn}{p.method ? ` · ${p.method}` : ''}</span>
                                  {rcp && <span className="font-mono text-gray-500">{rcp}</span>}
                                  <span className="font-semibold text-gray-800">{fmtMoney(p.amount, p.currency || plan.currency)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
      </PageLayout>
    );
  }

  // List view
  return (
    <PageLayout title={t('archive.title')} subtitle={t('archive.subtitle')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map(c => (
          <Card key={c.id} hover onClick={() => setSelectedId(c.id)}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-5 h-5 text-primary-700" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 truncate">{c.fullName}</p>
                <p className="text-xs text-gray-500">
                  {reasonLabel(c.reason)}{c.departureDate ? ` · ${c.departureDate}` : ''}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageLayout>
  );
}
