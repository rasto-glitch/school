// Human-readable companion PDF for the transfer JSON bundle. The
// destination admin (typically at a non-Scholify school) reads this
// document, sees the academic record + consent + signature header, and
// imports the JSON pack manually into their own SIS.
//
// Design choices:
//   • Single-column layout; A4; bilingual-friendly (caller passes Lang).
//   • Embed source-school logo + integrity panel (sha256 + signature) so
//     the destination can compare against the JSON pack's integrity block.
//   • Every section that exists in the JSON has a matching PDF section
//     header (Student, Parents, Destination, Consent, Academic
//     progression, Grades). A missing JSON field renders as em-dash.

import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import { COLORS, fetchLogoBuffer, L, type Lang } from './archivePdfShared';
import type { SignedTransferBundle, TransferBundle } from './transferBundle';

export async function streamTransferBundlePdf(
  signed: SignedTransferBundle,
  lang: Lang,
  dest: NodeJS.WritableStream,
): Promise<void> {
  const l = L[lang];
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const F = setupPdfFonts(doc);
  doc.pipe(dest);

  const b = signed.bundle;

  // ─── Header strip ─────────────────────────────────────────────────
  const logoBuf = await fetchLogoBuffer(b.sourceSchool.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { fit: [56, 56] }); } catch { /* ignore invalid image */ }
  }

  const headX = logoBuf ? 110 : 40;
  doc.font(F.bold).fontSize(16).fillColor(COLORS.heading).text(b.sourceSchool.name, headX, 44);
  doc.font(F.regular).fontSize(10).fillColor(COLORS.muted)
    .text('Student transfer record', headX, 64);
  doc.text(`Transfer ID: ${b.transferId}`, headX, 78);
  doc.text(`Generated: ${b.generatedAt}`, headX, 92);

  let y = 120;
  doc.moveTo(40, y).lineTo(555, y).strokeColor(COLORS.border).stroke();
  y += 12;

  // ─── Section helper ───────────────────────────────────────────────
  const section = (title: string, rows: Array<[string, string | null | undefined]>) => {
    if (y > 720) { doc.addPage(); y = 50; }
    doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(title.toUpperCase(), 40, y);
    y += 14;
    doc.font(F.regular).fontSize(10).fillColor(COLORS.body);
    for (const [label, value] of rows) {
      const v = (value && String(value).trim()) || l.em_dash;
      doc.font(F.regular).fontSize(10).fillColor(COLORS.muted).text(label, 40, y, { width: 150, continued: false });
      doc.font(F.pick(v)).fontSize(10).fillColor(COLORS.body).text(v, 200, y, { width: 355 });
      y = doc.y + 2;
    }
    y += 6;
    doc.moveTo(40, y - 3).lineTo(555, y - 3).strokeColor(COLORS.border).stroke();
    y += 6;
  };

  // ─── Student ──────────────────────────────────────────────────────
  section('Student', [
    [l.full_name, b.student.fullName],
    [l.date_of_birth, b.student.dateOfBirth],
    [l.phone, b.student.phoneNumber],
    [l.emergency_contact, b.student.emergencyContact],
    [l.address, b.student.homeAddress],
  ]);

  // ─── Parents / guardians ──────────────────────────────────────────
  if (b.parents.length > 0) {
    section(l.sec_parent, b.parents.flatMap((p, i) => [
      [`${l.parent_name}${b.parents.length > 1 ? ` (${i + 1})` : ''}`, p.fullName],
      [`${l.parent_phone}${b.parents.length > 1 ? ` (${i + 1})` : ''}`, p.phoneNumber],
    ] as Array<[string, string | null]>));
  }

  // ─── Destination ──────────────────────────────────────────────────
  section('Destination', [
    ['School', b.destination.schoolName],
    ['City', b.destination.city],
    ['Country', b.destination.country],
    ['Contact', b.destination.contact],
    ['Kind', b.destination.kind === 'scholify' ? 'Scholify' : 'Non-Scholify'],
  ]);

  // ─── Parental consent ─────────────────────────────────────────────
  section('Parental consent', [
    ['Parent name', b.consent.parentName],
    ['Signed at', b.consent.signedAt],
    ['Witness', b.consent.witnessName],
    ['Witness role', b.consent.witnessRole],
    ['Text version', b.consent.textVersion],
    ['Consent hash', b.consent.hash],
  ]);

  // ─── Academic progression ─────────────────────────────────────────
  if (y > 700) { doc.addPage(); y = 50; }
  doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(l.sec_academic_progression.toUpperCase(), 40, y);
  y += 14;
  const hist = b.academicRecord.enrollmentHistory;
  if (hist.length === 0) {
    doc.font(F.regular).fontSize(10).fillColor(COLORS.muted).text('—', 40, y);
    y = doc.y + 6;
  } else {
    doc.font(F.regular).fontSize(10).fillColor(COLORS.body);
    for (const e of hist) {
      if (y > 760) { doc.addPage(); y = 50; }
      const academicYear = String((e as any).academicYear ?? '—');
      const gradeLevel = String((e as any).gradeLevel ?? '—');
      const className = (e as any).className ? ` (${(e as any).className})` : '';
      const status = String((e as any).status ?? '');
      const statusLabel = statusFromBundle(status, l);
      const line = `  • ${academicYear} — ${gradeLevel}${className} — ${statusLabel}`;
      doc.font(F.pick(line)).text(line, 40, y, { width: 515 });
      y = doc.y + 2;
    }
    y += 6;
  }
  doc.moveTo(40, y - 3).lineTo(555, y - 3).strokeColor(COLORS.border).stroke();
  y += 6;

  // ─── Grades summary ───────────────────────────────────────────────
  if (y > 700) { doc.addPage(); y = 50; }
  doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(l.sec_grades.toUpperCase(), 40, y);
  y += 14;
  const grades = b.academicRecord.grades;
  if (grades.length === 0) {
    doc.font(F.regular).fontSize(10).fillColor(COLORS.muted).text(l.no_grades, 40, y);
    y = doc.y + 6;
  } else {
    drawGradesTable(doc, F, grades, () => {
      if (doc.y > 760) { doc.addPage(); doc.y = 50; }
    });
    y = doc.y + 6;
  }
  doc.moveTo(40, y - 3).lineTo(555, y - 3).strokeColor(COLORS.border).stroke();
  y += 6;

  // ─── Integrity panel ──────────────────────────────────────────────
  if (y > 700) { doc.addPage(); y = 50; }
  doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text('INTEGRITY', 40, y);
  y += 14;
  doc.font(F.regular).fontSize(9).fillColor(COLORS.body)
    .text(`Algorithm: ${signed.integrity.algorithm}`, 40, y); y = doc.y + 2;
  doc.text(`Key ID: ${signed.integrity.keyId}`, 40, y); y = doc.y + 2;
  doc.text(`Signed at: ${signed.integrity.signedAt}`, 40, y); y = doc.y + 2;
  doc.text(`SHA-256: ${signed.integrity.sha256}`, 40, y, { width: 515 }); y = doc.y + 2;
  doc.text(`Signature: ${signed.integrity.signature}`, 40, y, { width: 515 }); y = doc.y + 6;
  doc.fontSize(8).fillColor(COLORS.muted)
    .text(
      'The destination school can verify this transfer by recomputing the ' +
      'SHA-256 of the canonical bundle JSON and matching it against the hash ' +
      'above. The HMAC signature uses a Scholify-side key; contact the source ' +
      'school for verification if needed.',
      40, y, { width: 515 },
    );

  // ─── Page footer (per page, drawn at the end) ────────────────────
  const range = (doc as any).bufferedPageRange();
  const total = range.start + range.count;
  for (let i = range.start; i < total; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor(COLORS.muted)
      .text(
        `Scholify · transfer ${b.transferId} · page ${i + 1} of ${total}`,
        40, 810, { width: 515, align: 'center' },
      );
  }

  doc.end();
}

// Friendly labels for the enrollment status — mirrors the same set the
// archive PDF uses. Falls back to the raw status when not localised yet.
function statusFromBundle(status: string, l: typeof L.en): string {
  switch (status) {
    case 'enrolled':    return l.status_enrolled;
    case 'promoted':    return l.status_promoted;
    case 'retained':    return l.status_retained;
    case 'on_leave':    return l.status_on_leave;
    case 'withdrew':    return l.status_withdrew;
    case 'transferred': return l.status_transferred;
    case 'graduated':   return l.status_graduated;
    default:            return status || '';
  }
}

// Per-year grade table. Manual layout because PDFKit has no native tables.
function drawGradesTable(
  doc: PDFKit.PDFDocument,
  F: ReturnType<typeof setupPdfFonts>,
  grades: TransferBundle['academicRecord']['grades'],
  onPageBreak: () => void,
): void {
  const startX = 40;
  const cols = [
    { label: 'Year', w: 80 },
    { label: 'Period', w: 70 },
    { label: 'Subject', w: 160 },
    { label: 'Daily', w: 45 },
    { label: 'Quiz', w: 45 },
    { label: 'Monthly', w: 55 },
    { label: 'Term', w: 60 },
  ];
  const rowH = 16;

  const drawHeader = () => {
    let x = startX;
    doc.font(F.bold).fontSize(8).fillColor(COLORS.body);
    for (const c of cols) {
      doc.rect(x, doc.y, c.w, rowH).fillAndStroke('#F3F4F6', '#D1D5DB').fillColor(COLORS.body);
      doc.text(c.label, x + 4, doc.y + 4, { width: c.w - 8, ellipsis: true });
      x += c.w;
    }
    doc.y = doc.y + rowH;
  };

  drawHeader();

  for (const g of grades) {
    onPageBreak();
    if (doc.y === 50) drawHeader();    // we paginated; re-emit header

    let x = startX;
    const row = [
      String((g as any).academicYear ?? ''),
      String((g as any).gradingPeriod ?? ''),
      String((g as any).subject ?? ''),
      (g as any).dailyGrade != null ? String((g as any).dailyGrade) : '',
      (g as any).quizGrade != null ? String((g as any).quizGrade) : '',
      (g as any).monthlyExamGrade != null ? String((g as any).monthlyExamGrade) : '',
      (g as any).termExamGrade != null ? String((g as any).termExamGrade) : '',
    ];
    doc.font(F.regular).fontSize(8).fillColor(COLORS.body);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      doc.rect(x, doc.y, c.w, rowH).stroke('#E5E7EB');
      doc.text(row[i], x + 4, doc.y + 4, { width: c.w - 8, ellipsis: true });
      x += c.w;
    }
    doc.y = doc.y + rowH;
  }
}
