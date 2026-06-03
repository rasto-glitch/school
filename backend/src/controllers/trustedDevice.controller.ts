import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import { logAudit } from '../utils/audit';
import type { AuthRequest } from '../middleware/auth';

// GET /auth/trusted-devices — list this user's active trusted devices.
// "Active" = not revoked and not expired. We hide token_hash and
// don't return the raw token (we don't have it — the client does).
export async function listTrustedDevices(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  // tenant-check-allow: trusted_devices is user-keyed
  const { data } = await supabase
    .from('trusted_devices')
    .select('id, device_label, user_agent, ip, created_at, last_seen_at, expires_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gte('expires_at', new Date().toISOString())
    .order('last_seen_at', { ascending: false });
  res.json({ devices: (data || []) });
}

// POST /auth/trusted-devices/:id/revoke — revoke one device (the user's
// own, by row id). Useful for "I lost my laptop" without nuking every
// other trusted browser.
export async function revokeTrustedDevice(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const id = (req.params as { id: string }).id;
  // tenant-check-allow: trusted_devices is user-keyed; the eq(user_id)
  // is the tenant fence — a user can only revoke their own row.
  const { data: row } = await supabase
    .from('trusted_devices')
    .select('id, revoked_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  const r = row as { id: string; revoked_at: string | null } | null;
  if (!r) {
    res.status(404).json({ error: 'Trusted device not found.' });
    return;
  }
  if (r.revoked_at) {
    res.json({ ok: true }); // idempotent
    return;
  }
  // tenant-check-allow: trusted_devices is user-keyed; id resolved above
  await supabase.from('trusted_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);
  res.json({ ok: true });
  void logAudit({
    req,
    entityType: 'trusted_device',
    entityId: id,
    action: 'delete',
    label: 'trusted_device_revoked',
  });
}

// POST /auth/trusted-devices/revoke-all — kill every trusted device for
// this user. The blunt-instrument version of the above; useful when the
// user thinks any of their devices might be compromised but isn't sure
// which.
export async function revokeAllTrustedDevicesEndpoint(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  // tenant-check-allow: trusted_devices is user-keyed
  await supabase.from('trusted_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
  res.json({ ok: true });
  void logAudit({
    req,
    entityType: 'trusted_device',
    entityId: userId!,
    action: 'delete',
    label: 'trusted_devices_revoked_all',
  });
}
