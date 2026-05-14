import * as fs from 'fs';
import * as path from 'path';

const ENV_PATH = path.resolve(__dirname, '..', '.env.test');

function read(): string[] {
  if (!fs.existsSync(ENV_PATH)) return [];
  return fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
}

function write(lines: string[]): void {
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
}

// Idempotently set KEY=value in .env.test. Preserves comments and ordering;
// updates the line in place when the key already exists, appends otherwise.
export function setEnvKey(key: string, value: string): void {
  const lines = read();
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const idx = lines.findIndex(l => re.test(l));
  const newLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    lines.push(newLine);
  }
  write(lines);
  process.env[key] = value;
}

export function setEnvKeys(entries: Record<string, string>): void {
  for (const [k, v] of Object.entries(entries)) setEnvKey(k, v);
}
