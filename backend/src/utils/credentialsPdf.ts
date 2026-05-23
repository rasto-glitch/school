// Printable login-credentials PDF. 4 cards per A4 page (2x2) with cut lines
// between them so the school can hand each user a slip with their username
// and default password.

import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';

export interface CredentialEntry {
  fullName: string;
  role: 'parent' | 'teacher' | 'driver';
  username: string;
  password: string;
  // Parent-only context: children's names + class names
  children?: { name: string; className: string | null }[];
}

const ROLE_LABEL: Record<CredentialEntry['role'], string> = {
  parent: 'Parent',
  teacher: 'Teacher',
  driver: 'Driver',
};

export function streamCredentialsPdf(
  schoolName: string,
  title: string,
  entries: CredentialEntry[],
  dest: NodeJS.WritableStream,
): void {
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
  const F = setupPdfFonts(doc);
  doc.pipe(dest);

  // ---- Cover header on first page ----
  doc.fontSize(20).fillColor('#111827').font(F.pick(schoolName, { bold: true })).text(schoolName, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(13).fillColor('#374151').text(title, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor('#6B7280')
    .text(`${entries.length} account${entries.length === 1 ? '' : 's'} · Generated ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown(0.6);

  if (entries.length === 0) {
    doc.fontSize(12).fillColor('#6B7280').text('No accounts match this filter.', { align: 'center' });
    doc.end();
    return;
  }

  // ---- Card grid: 2 columns × 2 rows = 4 cards per page ----
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 36;
  const gridTopFirstPage = doc.y + 8;     // below the cover header
  const gridTopOtherPages = margin;
  const gridBottom = pageH - margin;

  const cols = 2;
  const rows = 2;
  const gutter = 14;
  const cardW = (pageW - margin * 2 - gutter * (cols - 1)) / cols;

  let firstPage = true;
  let cardsOnPage = 0;
  let gridTop = gridTopFirstPage;
  let cardH = (gridBottom - gridTop - gutter * (rows - 1)) / rows;

  for (let i = 0; i < entries.length; i++) {
    if (cardsOnPage === 0 && !firstPage) {
      gridTop = gridTopOtherPages;
      cardH = (gridBottom - gridTop - gutter * (rows - 1)) / rows;
    }

    const col = cardsOnPage % cols;
    const row = Math.floor(cardsOnPage / cols);
    const x = margin + col * (cardW + gutter);
    const y = gridTop + row * (cardH + gutter);

    drawCard(doc, x, y, cardW, cardH, schoolName, entries[i]);

    cardsOnPage++;
    if (cardsOnPage === cols * rows && i < entries.length - 1) {
      doc.addPage();
      cardsOnPage = 0;
      firstPage = false;
    }
  }

  doc.end();
}

function drawCard(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  schoolName: string,
  entry: CredentialEntry,
): void {
  const F = setupPdfFonts(doc);
  // Dashed border (acts as cut line)
  doc.save();
  doc.lineWidth(0.8).strokeColor('#9CA3AF').dash(4, { space: 3 });
  doc.rect(x, y, w, h).stroke();
  doc.undash();
  doc.restore();

  const padX = 14;
  const padY = 12;
  let cy = y + padY;

  // School name
  doc.fontSize(9).fillColor('#6B7280').font(F.pick(schoolName)).text(schoolName, x + padX, cy, {
    width: w - padX * 2, align: 'center', ellipsis: true,
  });
  cy += 14;

  // "Login Credentials" label
  doc.fontSize(8).fillColor('#9CA3AF').text('Login Credentials', x + padX, cy, {
    width: w - padX * 2, align: 'center',
  });
  cy += 14;

  // Full name (bold, large)
  doc.fontSize(13).fillColor('#111827').font(F.pick(entry.fullName, { bold: true })).text(entry.fullName, x + padX, cy, {
    width: w - padX * 2, align: 'center', ellipsis: true,
  });
  cy += 18;

  // Role
  doc.fontSize(9).fillColor('#374151').font(F.regular).text(ROLE_LABEL[entry.role], x + padX, cy, {
    width: w - padX * 2, align: 'center',
  });
  cy += 16;

  // Username + password rows
  const labelW = 70;
  const rowH = 16;

  doc.fontSize(9).fillColor('#6B7280').text('Username:', x + padX, cy, { width: labelW });
  doc.fontSize(11).fillColor('#111827').font('Courier-Bold').text(entry.username, x + padX + labelW, cy, {
    width: w - padX * 2 - labelW, ellipsis: true,
  });
  cy += rowH;

  doc.font(F.regular).fontSize(9).fillColor('#6B7280').text('Password:', x + padX, cy, { width: labelW });
  doc.fontSize(11).fillColor('#111827').font('Courier-Bold').text(entry.password, x + padX + labelW, cy, {
    width: w - padX * 2 - labelW, ellipsis: true,
  });
  cy += rowH + 2;

  // Children (parent only) — bottom block
  if (entry.role === 'parent' && entry.children && entry.children.length > 0) {
    doc.font(F.regular).fontSize(8).fillColor('#9CA3AF').text('Children:', x + padX, cy, { width: w - padX * 2 });
    cy += 10;
    doc.fontSize(9).fillColor('#374151');
    const remaining = y + h - cy - padY;
    const lineH = 11;
    const maxLines = Math.max(1, Math.floor(remaining / lineH));
    const visible = entry.children.slice(0, maxLines);
    for (const c of visible) {
      const line = c.className ? `${c.name}  ·  ${c.className}` : c.name;
      doc.font(F.pick(line)).text(line, x + padX, cy, { width: w - padX * 2, ellipsis: true });
      cy += lineH;
    }
    if (entry.children.length > visible.length) {
      doc.fillColor('#9CA3AF').text(`+ ${entry.children.length - visible.length} more`, x + padX, cy, { width: w - padX * 2 });
    }
  }

  // Footer note
  doc.font(F.regular).fontSize(7).fillColor('#9CA3AF').text(
    'Default password — please change after first login.',
    x + padX, y + h - padY - 8,
    { width: w - padX * 2, align: 'center' },
  );

  // Reset state for the next card
  doc.fillColor('black').font(F.regular);
}
