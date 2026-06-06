// Downloads a batch of MFA recovery codes as a plain-text file. The
// filename includes a date so the user can keep multiple snapshots
// (e.g. before/after regeneration) without one silently overwriting
// the other in their Downloads folder.

export function downloadRecoveryCodes(codes: string[], opts?: { schoolName?: string; username?: string }): void {
  const lines: string[] = [];
  lines.push('Scholify two-factor recovery codes');
  if (opts?.schoolName) lines.push(`School: ${opts.schoolName}`);
  if (opts?.username) lines.push(`Account: ${opts.username}`);
  lines.push(`Saved: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('Keep these somewhere safe. Each code works ONCE — when you');
  lines.push("lose your authenticator app, type one in place of the 6-digit");
  lines.push('code at sign-in. Burn them after use.');
  lines.push('');
  lines.push(...codes);
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `scholify-recovery-codes-${today}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the blob URL on the next tick so the click handler has run.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
