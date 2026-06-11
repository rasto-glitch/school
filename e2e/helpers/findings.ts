// Append-only writer for FINDINGS.md. Tests call recordFinding(...) when they
// observe something worth flagging. The file is the single source of truth
// the user reviews after a run — we don't put findings in test output alone
// because Playwright's reporter formats them in a way that's easy to lose.

import * as fs from 'fs';
import * as path from 'path';

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
export type Day = 'admin' | 'teacher' | 'supervisor' | 'driver' | 'parent' | 'accountant';

interface Finding {
  day: Day;
  severity: Severity;
  feature: string;
  issue: string;
  repro: string;
  screenshot?: string;
}

const SEVERITY_EMOJI: Record<Severity, string> = {
  Critical: '🟥 Critical',
  High:     '🟧 High',
  Medium:   '🟨 Medium',
  Low:      '🟦 Low',
  Info:     '🟩 Info',
};

const FINDINGS_PATH = path.resolve(__dirname, '..', 'FINDINGS.md');

// Strip pipe chars from cell content so the markdown table doesn't break.
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br/>').trim();

function nextRowNumber(text: string): number {
  // Last `| N |` row before "## Run log".
  const upToRunLog = text.split('## Run log')[0];
  const matches = Array.from(upToRunLog.matchAll(/^\|\s*(\d+)\s*\|/gm));
  if (matches.length === 0) return 1;
  const last = Math.max(...matches.map(m => Number(m[1])));
  return last + 1;
}

export function recordFinding(f: Finding): void {
  if (!fs.existsSync(FINDINGS_PATH)) {
    throw new Error(`FINDINGS.md not found at ${FINDINGS_PATH}`);
  }
  let text = fs.readFileSync(FINDINGS_PATH, 'utf8');

  // Drop the placeholder row on first real finding.
  text = text.replace(
    /\| — \| — \| — \| — \| — \| _no findings yet — runs will append here_ \| — \| — \|\n/,
    '',
  );

  const n = nextRowNumber(text);
  const row = `| ${n} | ${cell(f.day)} | ${SEVERITY_EMOJI[f.severity]} | OPEN | ${cell(f.feature)} | ${cell(f.issue)} | ${cell(f.repro)} | ${f.screenshot ? cell(f.screenshot) : '—'} |\n`;

  // Insert before the "## Run log" header so the findings table stays
  // contiguous regardless of order of writes.
  const runLogIdx = text.indexOf('## Run log');
  if (runLogIdx === -1) {
    text += row;
  } else {
    text = text.slice(0, runLogIdx) + row + '\n' + text.slice(runLogIdx);
  }
  fs.writeFileSync(FINDINGS_PATH, text, 'utf8');
  // Echo to test output too, so a CI tail surface still sees it.
  // eslint-disable-next-line no-console
  console.log(`[finding] ${f.day} · ${f.severity} · ${f.feature} — ${f.issue}`);
}

export function appendRunLog(daysRun: string, summary: string, notes: string): void {
  if (!fs.existsSync(FINDINGS_PATH)) return;
  let text = fs.readFileSync(FINDINGS_PATH, 'utf8');
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const row = `| ${cell(stamp)} | ${cell(daysRun)} | ${cell(summary)} | ${cell(notes)} |\n`;

  // Drop the placeholder run-log row on first real append.
  text = text.replace(
    /\| — \| — \| — \| _populated by the runner_ \|\n/,
    '',
  );
  text += row;
  fs.writeFileSync(FINDINGS_PATH, text, 'utf8');
}
