import path from 'path';
import fs from 'fs';

// Embedded fonts for PDF exports.
//
// pdfkit's built-in Helvetica is Latin-1 only — anything outside that range
// (em-dash, curly quotes, accented Latin, €/₹/₺/₪ symbols) renders as garbage.
// DejaVu Sans (OFL) covers all of that and is the default body font.
//
// Arabic/Kurdish: rendered with Noto Naskh Arabic. pdfkit drives fontkit's
// layout engine, which DOES apply complex-script shaping (letter joining) AND
// Unicode bidi reordering — so right-to-left Arabic and Kurdish-Sorani text
// (including ڵ ڕ ێ ۆ گ چ پ ژ, which have no presentation-form codepoints and
// only shape via OpenType GSUB) render correctly. The only requirement is a
// font with proper Arabic GSUB — DejaVu's Arabic is too weak, Noto Naskh isn't.
// So we switch to Noto Naskh for any string that contains Arabic-script chars.
//
// Standard font names ('Helvetica') can't be overridden — pdfkit special-cases
// them before registered fonts — so callers must use the names returned here.

// Resolves to backend/assets/fonts whether running from src/ (ts-node) or
// dist/ (compiled): both utils dirs sit two levels under backend/.
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

// Arabic, Arabic Supplement, Extended-A, and the presentation-form blocks.
const ARABIC_RANGE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export function hasArabic(s: string): boolean { return ARABIC_RANGE.test(String(s ?? '')); }

export interface PdfFonts {
  regular: string;
  bold: string;
  oblique: string;
  arabic: string;
  arabicBold: string;
  // Picks the right font for a string: the Arabic font when it contains
  // Arabic-script characters, otherwise the Latin body font.
  pick: (text: unknown, opts?: { bold?: boolean }) => string;
}

function build(regular: string, bold: string, oblique: string, arabic: string, arabicBold: string): PdfFonts {
  return {
    regular, bold, oblique, arabic, arabicBold,
    pick: (text, opts) => hasArabic(String(text ?? ''))
      ? (opts?.bold ? arabicBold : arabic)
      : (opts?.bold ? bold : regular),
  };
}

const STANDARD = build('Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica', 'Helvetica-Bold');

// Registers the embedded fonts on the document and returns the names to use.
// Falls back gracefully: Helvetica if the Latin font is missing; the Latin
// body font for Arabic if only Noto Naskh is missing — so PDF generation never
// hard-fails.
export function setupPdfFonts(doc: PDFKit.PDFDocument): PdfFonts {
  try {
    const reg = path.join(FONT_DIR, 'DejaVuSans.ttf');
    const bold = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');
    const obl = path.join(FONT_DIR, 'DejaVuSans-Oblique.ttf');
    const ar = path.join(FONT_DIR, 'NotoNaskhArabic-Regular.ttf');
    const arB = path.join(FONT_DIR, 'NotoNaskhArabic-Bold.ttf');

    if (!fs.existsSync(reg) || !fs.existsSync(bold) || !fs.existsSync(obl)) {
      console.error('[pdf] embedded Latin font files missing, falling back to Helvetica:', FONT_DIR);
      return STANDARD;
    }
    doc.registerFont('Body', reg);
    doc.registerFont('Body-Bold', bold);
    doc.registerFont('Body-Oblique', obl);

    let arabic = 'Body', arabicBold = 'Body-Bold'; // degraded fallback if Noto Naskh missing
    if (fs.existsSync(ar) && fs.existsSync(arB)) {
      doc.registerFont('Ar', ar);
      doc.registerFont('Ar-Bold', arB);
      arabic = 'Ar'; arabicBold = 'Ar-Bold';
    } else {
      console.error('[pdf] Noto Naskh Arabic missing — Arabic/Kurdish will render unshaped:', FONT_DIR);
    }
    return build('Body', 'Body-Bold', 'Body-Oblique', arabic, arabicBold);
  } catch (e) {
    console.error('[pdf] font registration failed, falling back to Helvetica:', (e as Error).message);
    return STANDARD;
  }
}
