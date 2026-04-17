import { useEffect, useState, useCallback } from 'react';
import { Search, Archive, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Modal from '../../components/common/Modal';
import type { Class } from '../../types';

// Same grade-map builder used in GraduatedStudentsTab
function buildGradeMap(grades: any[]): Record<string, Record<string, Record<string, any>>> {
  const map: Record<string, Record<string, Record<string, any>>> = {};
  for (const g of grades) {
    const year   = g.academicYear  || 'Unknown Year';
    const period = g.gradingPeriod || 'Unknown Term';
    if (!map[year]) map[year] = {};
    if (!map[year][period]) map[year][period] = {};
    map[year][period][g.subject] = g;
  }
  return map;
}

const REASON_LABEL: Record<string, string> = {
  transferred: 'Transferred',
  withdrew: 'Withdrew',
};
const REASON_COLOR: Record<string, string> = {
  transferred: 'bg-blue-100 text-blue-700',
  withdrew:    'bg-amber-100 text-amber-700',
};

export default function ArchivedStudentsTab() {
  const [students, setStudents]     = useState<any[]>([]);
  const [classes, setClasses]       = useState<Class[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [subjects, setSubjects]     = useState<{ id: string; name: string }[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail]         = useState<any | null>(null);

  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => {
    adminApi.getSubjects().then(r => setSubjects(r.data || []));
    adminApi.getClasses().then(r => setClasses(r.data || []));
  }, []);

  const selectedClassName = classes.find(c => c.id === classFilter)?.name;
  const filtered = selectedClassName
    ? students.filter(s => Array.isArray(s.classesAttended)
        && s.classesAttended.some((c: any) => c.className === selectedClassName))
    : students;

  const load = useCallback(() => {
    setLoading(true);
    adminApi.getArchivedStudents(debouncedSearch || undefined)
      .then(r => setStudents(r.data || []))
      .finally(() => setLoading(false));
  }, [debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const r = await adminApi.getArchivedStudent(id);
      setDetail(r.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const gradeMap     = detail ? buildGradeMap(detail.grades || []) : {};
  const academicYears = Object.keys(gradeMap).sort();

  // Group classesAttended by year for display
  const classesByYear: Record<string, string[]> = {};
  for (const c of (detail?.classesAttended || [])) {
    if (!classesByYear[c.year]) classesByYear[c.year] = [];
    if (!classesByYear[c.year].includes(c.className)) classesByYear[c.year].push(c.className);
  }
  const classYears = Object.keys(classesByYear).sort();

  const fmt = (d?: string) => d ? format(parseISO(d), 'MMM d, yyyy') : '—';

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-48">
          <Input
            placeholder="Search archived students..."
            icon={<Search className="w-4 h-4" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Select
            options={classes.map(c => ({ value: c.id, label: c.name }))}
            placeholder="All Classes"
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
          />
        </div>
        {!loading && (
          <span className="text-sm text-gray-400">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-16">
          <Archive className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {classFilter ? 'No archived students attended this class' : 'No archived students'}
          </p>
          <p className="text-xs text-gray-400 mt-1">Archived students appear here when removed via the Archive action</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(s => (
            <button key={s.id} onClick={() => openDetail(s.id)} className="text-left w-full">
              <Card className="hover:shadow-md hover:border-primary-200 transition-all cursor-pointer h-full">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-slate-600 font-bold text-sm">{s.fullName?.[0]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.fullName}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${REASON_COLOR[s.reason] || 'bg-gray-100 text-gray-600'}`}>
                        {REASON_LABEL[s.reason] || s.reason}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Left: {fmt(s.departureDate)}</p>
                    {s.parentFullName && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {s.parentFullName}{s.parentPhone ? ` · ${s.parentPhone}` : ''}
                      </p>
                    )}
                  </div>
                  <FileText className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={detailOpen}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        title="Archived Student Record"
        size="lg"
      >
        {detailLoading ? (
          <div className="flex justify-center py-10"><LoadingSpinner /></div>
        ) : detail ? (
          <div className="space-y-6">

            {/* Header */}
            <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-slate-600 font-bold text-lg">{detail.fullName?.[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-gray-900 text-lg">{detail.fullName}</p>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${REASON_COLOR[detail.reason] || 'bg-gray-100 text-gray-600'}`}>
                    {REASON_LABEL[detail.reason] || detail.reason}
                  </span>
                </div>
              </div>
            </div>

            {/* Personal info + classes side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Personal info */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Personal Info</p>
                <dl className="space-y-2">
                  <InfoRow label="Date of Birth"   value={fmt(detail.dateOfBirth)} />
                  <InfoRow label="Enrolled"         value={fmt(detail.enrollmentDate)} />
                  <InfoRow label="Left School"      value={fmt(detail.departureDate)} />
                  <InfoRow label="Parent / Guardian" value={detail.parentFullName || '—'} />
                  <InfoRow label="Parent Phone"     value={detail.parentPhone || '—'} />
                </dl>
              </div>

              {/* Classes attended */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Classes Attended</p>
                {classYears.length === 0 ? (
                  <p className="text-sm text-gray-400">No attendance records</p>
                ) : (
                  <div className="space-y-2">
                    {classYears.map(year => (
                      <div key={year} className="flex items-start gap-2">
                        <span className="text-xs font-medium text-gray-500 w-24 shrink-0 pt-0.5">{year}</span>
                        <div className="flex flex-wrap gap-1">
                          {classesByYear[year].map(cn => (
                            <span key={cn} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{cn}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Grades */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Academic Grades</p>
              {academicYears.length === 0 ? (
                <p className="text-sm text-gray-400">No grades recorded</p>
              ) : (
                <div className="space-y-8">
                  {academicYears.map(year => {
                    const periodMap = gradeMap[year];
                    const periods   = Object.keys(periodMap).sort();
                    const termTotals = periods.map(period =>
                      subjects.reduce((sum, subj) => {
                        const g = periodMap[period]?.[subj.name];
                        if (!g) return sum;
                        return sum + (g.dailyGrade || 0) + (g.quizGrade || 0) + (g.monthlyExamGrade || 0) + (g.termExamGrade || 0);
                      }, 0)
                    );
                    const yearMark = periods.length
                      ? (termTotals.reduce((a, b) => a + b, 0) / periods.length).toFixed(1)
                      : '—';

                    return (
                      <div key={year}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-sm font-bold text-gray-800">{year}</span>
                          <div className="flex-1 h-px bg-gray-200" />
                        </div>
                        <div className="space-y-4">
                          {periods.map(period => (
                            <div key={period}>
                              <p className="text-xs font-semibold text-gray-500 mb-2">{period}</p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-gray-50">
                                      <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">Subject</th>
                                      <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Daily</th>
                                      <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Quiz</th>
                                      <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Monthly</th>
                                      <th className="text-center px-3 py-2 font-medium text-gray-500 border border-gray-200">Term</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {subjects.map(subj => {
                                      const g = periodMap[period]?.[subj.name];
                                      return (
                                        <tr key={subj.id} className="hover:bg-gray-50">
                                          <td className="px-3 py-2 border border-gray-200 text-gray-700">{subj.name}</td>
                                          <td className="px-3 py-2 border border-gray-200 text-center font-medium">{g?.dailyGrade ?? '—'}</td>
                                          <td className="px-3 py-2 border border-gray-200 text-center font-medium">{g?.quizGrade ?? '—'}</td>
                                          <td className="px-3 py-2 border border-gray-200 text-center font-medium">{g?.monthlyExamGrade ?? '—'}</td>
                                          <td className="px-3 py-2 border border-gray-200 text-center font-medium">{g?.termExamGrade ?? '—'}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3">
                          <span className="text-sm text-gray-600">
                            Full Year Mark — {year} ({periods.length} term{periods.length !== 1 ? 's' : ''})
                          </span>
                          <span className="text-xl font-bold text-indigo-600">{yearMark}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-xs text-gray-400 w-28 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-gray-800 font-medium">{value}</dd>
    </div>
  );
}
