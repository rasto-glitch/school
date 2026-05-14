#!/usr/bin/env node
/*
 * Tenant-scoping backstop. Fails CI if any Supabase query in backend
 * controllers does not include a `school_id` filter.
 *
 * Rationale: multi-tenancy in this codebase is enforced purely by
 * developer discipline — every `.from('TABLE')` must chain
 * `.eq('school_id', schoolId)` (or filter by a column that implies the
 * school, like a user_id from the JWT). The service-role Supabase client
 * bypasses RLS, so a single forgotten filter leaks one school's data to
 * another. This linter catches the common case before it ships.
 *
 * The check is intentionally conservative — it ignores anything that
 * cannot be statically determined and supports an opt-out comment for
 * legitimate exceptions:
 *
 *   // tenant-check-allow: <one-line reason>
 *   const { data } = await supabase.from('device_tokens').delete()...
 *
 * Exit codes: 0 = clean, 1 = at least one suspicious query.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src', 'controllers');
const BASELINE_PATH = path.resolve(__dirname, 'tenant-check-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

// Tables whose queries are tenant-scoped by `id = schoolId` instead of
// `school_id = schoolId` (they ARE the tenant row).
const TENANT_ROOT_TABLES = new Set(['schools']);

// Pre-compiled regexes.
const FROM_RE = /\bsupabase\s*(?:\.\s*\n\s*)?\.from\s*\(\s*['"`]([a-zA-Z_]+)['"`]\s*\)/g;
const ALLOW_COMMENT_RE = /\/\/\s*tenant-check-allow\s*:/i;

// Patterns that count as "tenant-safe" in a query chain. Any one of these
// inside the same statement and we treat the query as scoped:
//   - school_id filter (the canonical case)
//   - filter by user_id (each user belongs to exactly one school)
//   - filter by id = userId (operating on the caller's own user row)
const SCOPE_PATTERNS = [
  /school_id/,
  /\.eq\s*\(\s*['"`]user_id['"`]/,
  /\.eq\s*\(\s*['"`]id['"`]\s*,\s*userId\b/,
];

function collectChain(src, fromMatchStart) {
  // Walk forward from the `.from` call until we hit a `;` at zero paren
  // depth, OR a blank line preceded by a closing paren — the end of the
  // chain. Track string and template-literal boundaries so we don't count
  // `;` inside them.
  let depth = 0;
  let inString = null; // single, double, or backtick char, or null
  let escape = false;
  let i = fromMatchStart;
  while (i < src.length) {
    const c = src[i];
    if (escape) { escape = false; i++; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === inString) inString = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; i++; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) return src.slice(fromMatchStart, i + 1);
    // Bail at end of statement-ish heuristic: if we hit an empty line at
    // depth 0 after at least one closing paren, treat as end.
    i++;
    if (depth < 0) return src.slice(fromMatchStart, i); // unbalanced — stop
  }
  return src.slice(fromMatchStart);
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

function previousLine(src, idx) {
  const before = src.slice(0, idx);
  const lines = before.split('\n');
  return lines[lines.length - 2] ?? '';
}

let suspicious = [];
let scanned = 0;

const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.ts'));
for (const file of files) {
  const full = path.join(ROOT, file);
  const src = fs.readFileSync(full, 'utf8');
  FROM_RE.lastIndex = 0;
  let m;
  while ((m = FROM_RE.exec(src)) !== null) {
    scanned++;
    const table = m[1];
    if (TENANT_ROOT_TABLES.has(table)) continue;

    // Opt-out comment on the line immediately above the .from call.
    const prevLine = previousLine(src, m.index);
    if (ALLOW_COMMENT_RE.test(prevLine)) continue;

    const chain = collectChain(src, m.index);
    if (SCOPE_PATTERNS.some(p => p.test(chain))) continue;

    suspicious.push({
      file,
      line: lineOf(src, m.index),
      table,
      preview: chain.split('\n').slice(0, 3).map(s => s.trim()).join(' ').slice(0, 140),
    });
  }
}

// Load the baseline of grandfathered offenders. Each entry is keyed
// `<file>:<table>`; we don't pin line numbers so refactors that move a
// line don't spuriously fail. The baseline shrinks as we audit and
// rescope individual queries.
let baseline = new Set();
if (fs.existsSync(BASELINE_PATH) && !UPDATE_BASELINE) {
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  baseline = new Set(raw.entries.map(e => `${e.file}:${e.table}`));
}

if (UPDATE_BASELINE) {
  // Snapshot the current state and exit.
  const entries = [];
  const seen = new Set();
  for (const s of suspicious) {
    const k = `${s.file}:${s.table}`;
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push({ file: s.file, table: s.table });
  }
  entries.sort((a, b) => a.file === b.file ? a.table.localeCompare(b.table) : a.file.localeCompare(b.file));
  fs.writeFileSync(
    BASELINE_PATH,
    JSON.stringify({
      _comment: "Grandfathered tenant-scoping offenders. Each entry is a controller-file/table pair where Supabase queries currently filter by something other than school_id (typically an id from a prior school-scoped query — safe by data flow but not statically verifiable). Audit these one by one and remove from this file as you scope them explicitly. New offenders not in this file will fail the check.",
      entries,
    }, null, 2) + '\n',
  );
  console.log(`Wrote baseline with ${entries.length} grandfathered file:table pairs to ${BASELINE_PATH}`);
  process.exit(0);
}

// Separate flagged items into known (in baseline) vs. new.
const newOffenders = [];
const grandfathered = [];
for (const s of suspicious) {
  if (baseline.has(`${s.file}:${s.table}`)) grandfathered.push(s);
  else newOffenders.push(s);
}

if (newOffenders.length === 0) {
  const note = grandfathered.length
    ? ` (${grandfathered.length} grandfathered — see tenant-check-baseline.json)`
    : '';
  console.log(`✓ tenant-scoping: ${scanned} supabase.from() calls scanned, no new offenders${note}.\n`);
  process.exit(0);
}

console.error(`✗ tenant-scoping: ${newOffenders.length} new supabase.from() call(s) do not appear to filter by school_id.\n`);
for (const s of newOffenders) {
  console.error(`  ${s.file}:${s.line}  from('${s.table}')  ${s.preview}`);
}
console.error(
  "\nEach query above must either chain .eq('school_id', schoolId) or have a\n" +
  "// tenant-check-allow: <reason> comment on the line immediately before the .from call.\n" +
  "\nIf the offender is genuinely safe by data flow (id sourced from a prior\n" +
  "school-scoped query) and you want to grandfather it in, regenerate the\n" +
  "baseline with `node scripts/check-tenant-scoping.cjs --update-baseline`.\n",
);
process.exit(1);
