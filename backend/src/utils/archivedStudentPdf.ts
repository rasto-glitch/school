// Per-record PDF export for archived_students. Sibling of
// archivedEmployeePdf.ts; shares label maps and helpers via
// archivePdfShared.ts. Renders identity + enrollment + parent
// contact + class history (jsonb) + a grades summary table.

import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import { supabase } from '../config/supabase';
import { COLORS, fetchLogoBuffer, L, type Labels, type Lang } from './archivePdfShared';

type Row = [string, string | null | undefined];

interface ArchivedStudentRow {
  id: string;
  school_id: string;
  full_name: string;
  date_of_birth: string | null;
  enrollment_date: string | null;
  departure_date: string | null;
  reason: string | null;
  parent_full_name: string | null;
  parent_phone: string | null;
  // Legacy per-archive JSONB (migration 030): attendance-derived class
  // list. Still present on the row because of the tamper-evidence hash
  // contract (see migration 019 _canon_archived_student). Reads should
  // prefer enrollment_history below; we only fall back to this when the
  // new column is empty (pre-backfill archives).
  classes_attended: Array<{ year: string | null; classId: string; className: string }> | null;
  enrollment_history: Array<{
    academicYear: string;
    gradeLevel: string;
    classId: string | null;
    className: string | null;
    status: string;
    startedOn: string | null;
    endedOn: string | null;
  }> | null;
  grades: Array<{ academicYear: string | null; subject: string | null; className: string | null; termExamGrade: number | null; monthlyExamGrade: number | null; quizGrade: number | null; dailyGrade: number | null }> | null;
  snapshot_version: number | null;
  archived_by_name?: string | null;
  archived_by_role?: string | null;
  created_at: string;
}

export interface ArchivedStudentPdfData {
  school: { name: string; logoUrl: string | null };
  record: ArchivedStudentRow;
  generatedBy: string;
  generatedByRole: string;
}

export async function loadArchivedStudentForPdf(archiveId: string, schoolId: string): Promise<ArchivedStudentPdfData | null> {
  const [{ data: school }, { data: row }] = await Promise.all([
    supabase.from('schools').select('name, logo_url').eq('id', schoolId).single(),
    supabase.from('archived_students').select('*').eq('id', archiveId).eq('school_id', schoolId).single(),
  ]);
  if (!row) return null;

  return {
    school: { name: (school?.name as string) ?? 'School', logoUrl: (school?.logo_url as string) ?? null },
    record: row as ArchivedStudentRow,
    generatedBy: '',
    generatedByRole: '',
  };
}

function formatPdfStatus(status: string, l: Labels): string {
  switch (status) {
    case 'enrolled':    return l.status_enrolled;
    case 'promoted':    return l.status_promoted;
    case 'retained':    return l.status_retained;
    case 'on_leave':    return l.status_on_leave;
    case 'withdrew':    return l.status_withdrew;
    case 'transferred': return l.status_transferred;
    case 'graduated':   return l.status_graduated;
    default:            return status;
  }
}

function studentReasonLabel(reason: string | null, l: Labels): string {
  if (!reason) return l.em_dash;
  const map: Record<string, keyof Labels> = {
    graduated: 'reason_graduated',
    left: 'reason_left',
    relocated: 'reason_relocated',
    transferred: 'reason_transferred',
    other: 'reason_other_student',
  };
  const k = map[reason];
  return k ? l[k] : reason;
}

export async function streamArchivedStudentPdf(
  data: ArchivedStudentPdfData,
  lang: Lang,
  dest: NodeJS.WritableStream,
): Promise<void> {
  const l = L[lang];
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const F = setupPdfFonts(doc);
  doc.pipe(dest);

  // ─── Header strip ────────────────────────────────────────────────────
  const logoBuf = await fetchLogoBuffer(data.school.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { fit: [56, 56] }); } catch { /* invalid */ }
  }
  doc.font(F.pick(data.school.name, { bold: true })).fontSize(18).fillColor(COLORS.heading)
    .text(data.school.name, 110, 46);
  doc.font(F.regular).fontSize(10).fillColor(COLORS.muted)
    .text(l.archived_student_record, 110, 70);
  doc.moveTo(40, 108).lineTo(555, 108).strokeColor(COLORS.border).lineWidth(1).stroke();

  // ─── Identity card ───────────────────────────────────────────────────
  const r = data.record;
  doc.font(F.pick(r.full_name, { bold: true })).fontSize(22).fillColor(COLORS.heading)
    .text(r.full_name, 40, 124);
  const sub = [studentReasonLabel(r.reason, l), r.departure_date].filter(Boolean).join(' · ');
  doc.font(F.regular).fontSize(11).fillColor(COLORS.muted).text(sub, 40, 152);

  let y = 184;

  function section(title: string, rows: Row[]): void {
    const filtered = rows.filter(([, v]) => v != null && v !== '');
    if (filtered.length === 0) return;
    doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(title.toUpperCase(), 40, y);
    y += 14;
    const colW = 250, gap = 15, keyW = 110;
    let col = 0;
    let startY = y;
    let rowMaxY = y;
    for (const [k, v] of filtered) {
      const x = 40 + col * (colW + gap);
      doc.font(F.regular).fontSize(9).fillColor(COLORS.muted).text(k, x, y, { width: keyW });
      const valueStr = String(v);
      doc.font(F.pick(valueStr, { bold: true })).fontSize(10).fillColor(COLORS.body)
        .text(valueStr, x + keyW, y, { width: colW - keyW });
      rowMaxY = Math.max(rowMaxY, doc.y);
      col = (col + 1) % 2;
      if (col === 0) { y = rowMaxY + 4; startY = y; } else { y = startY; }
    }
    if (col !== 0) y = rowMaxY + 4;
    y += 10;
    doc.moveTo(40, y - 6).lineTo(555, y - 6).strokeColor(COLORS.border).stroke();
  }

  section(l.sec_personal, [
    [l.date_of_birth, r.date_of_birth],
  ]);

  section(l.sec_enrollment, [
    [l.enrollment_date, r.enrollment_date],
    [l.departure_date, r.departure_date],
    [l.reason, studentReasonLabel(r.reason, l)],
    [l.archived_at, r.created_at ? String(r.created_at).slice(0, 10) : null],
    [l.archived_by, r.archived_by_name ? `${r.archived_by_name}${r.archived_by_role ? ` (${r.archived_by_role})` : ''}` : null],
  ]);

  section(l.sec_parent, [
    [l.parent_name, r.parent_full_name],
    [l.parent_phone, r.parent_phone],
  ]);

  // Academic progression (migration 030). Prefer enrollment_history; for
  // pre-backfill archives fall back to the legacy classes_attended view
  // so the PDF still says something.
  const history = Array.isArray(r.enrollment_history) ? r.enrollment_history : [];
  const legacy = Array.isArray(r.classes_attended) ? r.classes_attended : [];
  const useHistory = history.length > 0;
  if (useHistory || legacy.length > 0) {
    doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(l.sec_academic_progression.toUpperCase(), 40, y);
    y += 14;
    doc.font(F.regular).fontSize(10).fillColor(COLORS.body);
    if (useHistory) {
      for (const e of history) {
        const cls = e.className ? ` (${e.className})` : '';
        const line = `  • ${e.academicYear} — ${e.gradeLevel}${cls} — ${formatPdfStatus(e.status, l)}`;
        doc.font(F.pick(line)).text(line, 40, y, { width: 515 });
        y = doc.y + 2;
      }
    } else {
      for (const c of legacy) {
        const line = `  • ${c.year ?? l.em_dash}: ${c.className}`;
        doc.font(F.pick(line)).text(line, 40, y, { width: 515 });
        y = doc.y + 2;
      }
    }
    y += 10;
    doc.moveTo(40, y - 6).lineTo(555, y - 6).strokeColor(COLORS.border).stroke();
  }

  // Grades summary
  if (y > 720) { doc.addPage(); y = 50; }
  doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(l.sec_grades.toUpperCase(), 40, y);
  y += 16;
  const grades = r.grades ?? [];
  if (grades.length === 0) {
    doc.font(F.regular).fontSize(10).fillColor(COLORS.muted).text(l.no_grades, 40, y);
    y = doc.y + 12;
  } else {
    const cols = [
      { label: l.col_period, w: 90 },   // academic year
      { label: l.class, w: 100 },
      { label: l.subject, w: 130 },
      { label: 'Daily', w: 50 },
      { label: 'Quiz', w: 50 },
      { label: 'Monthly', w: 50 },
      { label: 'Term', w: 45 },
    ];
    let x = 40;
    doc.font(F.bold).fontSize(9).fillColor(COLORS.heading);
    for (const c of cols) { doc.text(c.label, x, y, { width: c.w }); x += c.w; }
    y += 14;
    doc.moveTo(40, y - 4).lineTo(555, y - 4).strokeColor(COLORS.border).stroke();
    for (const g of grades) {
      x = 40;
      doc.font(F.regular).fontSize(9).fillColor(COLORS.body);
      const cells = [
        g.academicYear ?? l.em_dash,
        g.className ?? l.em_dash,
        g.subject ?? l.em_dash,
        g.dailyGrade != null ? String(g.dailyGrade) : l.em_dash,
        g.quizGrade != null ? String(g.quizGrade) : l.em_dash,
        g.monthlyExamGrade != null ? String(g.monthlyExamGrade) : l.em_dash,
        g.termExamGrade != null ? String(g.termExamGrade) : l.em_dash,
      ];
      for (let i = 0; i < cols.length; i++) {
        doc.font(F.pick(cells[i])).text(cells[i], x, y, { width: cols[i].w });
        x += cols[i].w;
      }
      y = doc.y + 4;
      if (y > 770) { doc.addPage(); y = 50; }
    }
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font(F.regular).fontSize(8).fillColor(COLORS.muted)
      .text(
        `${l.archive_id}: ${r.id}   ·   ${l.schema_version}: ${r.snapshot_version ?? 1}   ·   ${l.generated}: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC   ·   ${l.by} ${data.generatedBy || l.em_dash}${data.generatedByRole ? ` (${data.generatedByRole})` : ''}`,
        40, 800, { width: 515, align: 'left' },
      );
  }

  doc.end();
}
