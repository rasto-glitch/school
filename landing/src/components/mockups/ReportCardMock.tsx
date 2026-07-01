/**
 * Reproduction of a generated report-card PDF — school header, student meta,
 * per-subject marks and an overall line. Mirrors the pdfkit report card layout.
 */
const SUBJECTS = [
  { name: 'Mathematics', mark: 88, grade: 'A' },
  { name: 'Physics', mark: 82, grade: 'A' },
  { name: 'Arabic', mark: 76, grade: 'B' },
  { name: 'English', mark: 91, grade: 'A' },
  { name: 'Biology', mark: 79, grade: 'B' },
  { name: 'Islamic Studies', mark: 85, grade: 'A' },
];

export default function ReportCardMock() {
  return (
    <div className="mx-auto max-w-[300px] bg-white p-5 text-slate-900">
      {/* header */}
      <div className="flex items-center justify-between border-b-2 border-primary-600 pb-3">
        <div>
          <div className="text-[13px] font-extrabold leading-tight">Al-Noor International</div>
          <div className="text-[9px] text-slate-500">Term 2 Report Card · 2025–26</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-600 text-[13px] font-black text-white">S</div>
      </div>

      {/* student meta */}
      <div className="mt-3 grid grid-cols-2 gap-y-1 text-[9px]">
        <div><span className="text-slate-400">Student</span> <span className="font-semibold">Lana A. Karim</span></div>
        <div><span className="text-slate-400">Class</span> <span className="font-semibold">Grade 10 · A</span></div>
        <div><span className="text-slate-400">Roll no.</span> <span className="font-semibold">10-A-14</span></div>
        <div><span className="text-slate-400">Homeroom</span> <span className="font-semibold">Ms. Dilan</span></div>
      </div>

      {/* marks table */}
      <table className="mt-3 w-full border-collapse text-[9px]">
        <thead>
          <tr className="bg-slate-50 text-slate-500">
            <th className="border border-slate-200 px-2 py-1 text-start font-semibold">Subject</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">Mark</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">Grade</th>
          </tr>
        </thead>
        <tbody>
          {SUBJECTS.map((s) => (
            <tr key={s.name}>
              <td className="border border-slate-200 px-2 py-1 text-start">{s.name}</td>
              <td className="border border-slate-200 px-2 py-1 text-center font-semibold">{s.mark}</td>
              <td className="border border-slate-200 px-2 py-1 text-center">{s.grade}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* overall */}
      <div className="mt-3 flex items-center justify-between rounded-lg bg-primary-50 px-3 py-2">
        <span className="text-[10px] font-semibold text-primary-700">Overall average</span>
        <span className="text-[14px] font-extrabold text-primary-700">83.5% · A</span>
      </div>
      <div className="mt-2 text-[8px] leading-relaxed text-slate-500">
        <span className="font-semibold text-slate-600">Homeroom remark:</span> A strong, consistent term. Lana
        contributes thoughtfully in class and should keep up the excellent work.
      </div>
    </div>
  );
}
