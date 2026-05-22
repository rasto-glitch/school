import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { BarChart2, ArrowLeft } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Report } from '../../types';
import { format, parseISO } from 'date-fns';

export default function ReportDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    parentApi.getReportById(id).then(r => setReport(r.data || null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLayout title={t('reports.title')}><LoadingSpinner /></PageLayout>;
  if (!report) return <PageLayout title={t('reports.title')}><p className="text-gray-500">{t('reports.not_found')}</p></PageLayout>;

  const marks = report.marks && report.marks.length > 0
    ? report.marks
    : [
        ...(report.quizMarks != null ? [{ name: 'Quiz', value: report.quizMarks }] : []),
        ...(report.examMarks != null ? [{ name: 'Exam', value: report.examMarks }] : []),
      ];

  return (
    <PageLayout title={t('reports.title')}>
      <div className="max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate(-1)}>{t('common.back')}</Button>
        <div className="bg-gradient-to-r from-primary-600 to-secondary-500 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-2 mb-3 opacity-80">
            <BarChart2 className="w-5 h-5" />
            <span className="text-sm font-medium">{t('reports.student_report')}</span>
          </div>
          <h1 className="text-2xl font-bold mb-1">{report.subject}</h1>
          {report.students && <p className="text-white/80 text-sm mb-3">{report.students.fullName}</p>}
          <p className="text-white/60 text-xs">
            {report.reportDate
              ? format(parseISO(report.reportDate), 'MMMM d, yyyy')
              : format(parseISO(report.createdAt), 'MMMM d, yyyy')}
          </p>
        </div>

        {marks.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('reports.marks')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {marks.map((m, i) => (
                <div key={i} className="bg-primary-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-primary-600">{m.value}</div>
                  <div className="text-xs text-gray-500 mt-1">{m.name}</div>
                </div>
              ))}
            </div>
            {marks.length > 1 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                <span className="text-sm text-gray-500">{t('common.total')}</span>
                <span className="text-lg font-bold text-primary-600">
                  {marks.reduce((s, m) => s + m.value, 0).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        )}

        {(report.attendanceNotes || report.behaviorNotes || report.teacherNotes) && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{t('reports.notes')}</h2>
            {report.attendanceNotes && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">{t('reports.attendance')}</p>
                <p className="text-sm text-gray-700">{report.attendanceNotes}</p>
              </div>
            )}
            {report.behaviorNotes && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">{t('reports.behavior')}</p>
                <p className="text-sm text-gray-700">{report.behaviorNotes}</p>
              </div>
            )}
            {report.teacherNotes && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">{t('reports.teacher_notes')}</p>
                <p className="text-sm text-gray-700">{report.teacherNotes}</p>
              </div>
            )}
          </div>
        )}

        {report.teachers && (
          <p className="text-xs text-gray-400 px-1">{t('common.by_name', { name: report.teachers.fullName })}</p>
        )}
      </div>
    </PageLayout>
  );
}
