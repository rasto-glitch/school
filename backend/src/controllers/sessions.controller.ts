import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import { logAudit } from '../utils/audit';
import { labelDevice } from '../utils/trustedDevice';
import type { AuthRequest } from '../middleware/auth';

// User-visible "active sessions" list. A session corresponds to one
// refresh-token rotation family — that's the unit a user understands
// ("my laptop", "my phone in the kitchen"). We aggregate the family's
// rows in JS so the UI sees one entry per device:
//   - createdAt    = oldest token's created_at (when the session began)
//   - lastActivity = newest token's created_at (most recent refresh)
//   - device/ip    = from the newest token (latest known fingerprint)
//
// Revocation operates on the whole family, mirroring how /auth/refresh
// already burns the family on theft suspicion.

interface SessionRow {
  family_id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
}

// GET /auth/sessions
export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  // tenant-check-allow: refresh_tokens is user-keyed (filtered by user_id)
  const { data } = await supabase
    .from('refresh_tokens')
    .select('family_id, ip, user_agent, created_at, expires_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  const rows = (data || []) as SessionRow[];

  // Aggregate per family_id. Latest row's UA/IP wins for "device" — it
  // reflects the most recent refresh, which is the live state.
  const byFamily = new Map<string, { family_id: string; first: SessionRow; last: SessionRow }>();
  for (const r of rows) {
    const existing = byFamily.get(r.family_id);
    if (!existing) {
      byFamily.set(r.family_id, { family_id: r.family_id, first: r, last: r });
    } else {
      // rows came in DESC created_at, so the FIRST one we see is the
      // newest. Update `.first` only if this row is older.
      if (new Date(r.created_at) < new Date(existing.first.created_at)) existing.first = r;
      if (new Date(r.created_at) > new Date(existing.last.created_at)) existing.last = r;
    }
  }
  const sessions = Array.from(byFamily.values()).map(({ family_id, first, last }) => ({
    familyId: family_id,
    deviceLabel: labelDevice(last.user_agent || ''),
    userAgent: last.user_agent,
    ip: last.ip,
    createdAt: first.created_at,
    lastActivityAt: last.created_at,
    expiresAt: last.expires_at,
  })).sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

  res.json({ sessions });
}

// POST /auth/sessions/:familyId/revoke — revoke one session (one device).
// Burns every live token in the family. If the user revokes the family
// they're currently on, their next refresh attempt 401s and they're
// bounced to login — same as any other revoked-family case.
export async function revokeSession(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const familyId = (req.params as { familyId: string }).familyId;
  // tenant-check-allow: refresh_tokens is user-keyed; eq(user_id) is the
  // tenant fence — a user can only revoke their own families.
  const { data: existing } = await supabase
    .from('refresh_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('family_id', familyId)
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  // tenant-check-allow: refresh_tokens is user-keyed; family + user both checked
  await supabase.from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('family_id', familyId)
    .is('revoked_at', null);
  res.json({ ok: true });
  void logAudit({
    req,
    entityType: 'user_session',
    entityId: familyId,
    action: 'delete',
    label: 'session_revoked',
  });
}
