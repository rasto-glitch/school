import path from 'path';
import fs from 'fs';

// Embedded Unicode font for PDF exports.
//
// pdfkit's built-in Helvetica is a Latin-1 (WinAnsi) standard font — anything
// outside that range (em-dash, curly quotes, accented Latin, the €/₹/₺/₪ family
// of currency symbols, and Arabic-script glyphs used for IQD/SAR/AED and Arabic/
// Kurdish names) renders as garbage. DejaVu Sans (OFL/free) covers all of those.
//
// NOTE: Arabic is embedded as glyphs but NOT shaped — pdfkit has no RTL/ligature
// engine, so Arabic-script text renders unshaped left-to-right. Glyphs are
// correct (no more boxes/mojibake); full Arabic typesetting would need a shaping
// pass (harfbuzz) which is out of scope here.
//
// Standard font names ('Helvetica') can't be overridden — pdfkit special-cases
// them before registered fonts — so callers must use the names returned here.

// Resolves to backend/assets/fonts whether running from src/ (ts-node) or
// dist/ (compiled): both utils dirs sit two levels under backend/.
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

export interface PdfFonts { regular: string; bold: string; oblique: string }

const STANDARD: PdfFonts = { regular: 'Helvetica', bold: 'Helvetica-Bold', oblique: 'Helvetica-Oblique' };

// Registers the embedded fonts on the document and returns the names to use for
// regular / bold / oblique text. Falls back to the built-in Helvetica (so PDF
// generation never hard-fails) if the font files can't be loaded.
export function setupPdfFonts(doc: PDFKit.PDFDocument): PdfFonts {
  const reg = path.join(FONT_DIR, 'DejaVuSans.ttf');
  const bold = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');
  const obl = path.join(FONT_DIR, 'DejaVuSans-Oblique.ttf');
  try {
    // pdfkit registers lazily and only opens the file on first use — so verify
    // the files exist now, and fall back to the built-in font if they don't.
    if (!fs.existsSync(reg) || !fs.existsSync(bold) || !fs.existsSync(obl)) {
      console.error('[pdf] embedded font files missing, falling back to Helvetica:', FONT_DIR);
      return STANDARD;
    }
    doc.registerFont('Body', reg);
    doc.registerFont('Body-Bold', bold);
    doc.registerFont('Body-Oblique', obl);
    return { regular: 'Body', bold: 'Body-Bold', oblique: 'Body-Oblique' };
  } catch (e) {
    console.error('[pdf] Unicode font registration failed, falling back to Helvetica:', (e as Error).message);
    return STANDARD;
  }
}
