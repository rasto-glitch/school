// GET /admin/archived-employees/:id/profile — bundled read endpoint for the
// archived employee profile page. Returns the archive snapshot row plus the
// Wave 2 records that survived the archive via rewriteOwnershipToArchive
// (documents / extended / emergency contacts / acknowledgements / actions).
//
// Read-only by design: the archived view has no mutation endpoints, so the
// only data flow is one bundle out. Sensitivity rules mirror the live
// profile endpoint exactly — HR-officer-only fields surface as
// '[hr_officer_required]' for non-HR readers, same as
// loadWave2Bundle does for the live path.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { isHrOfficer } from '../utils/employeeDocs';
import { hasArchiveFeature } from '../utils/employeeArchive';
import { loadDocuments, loadWave2Bundle } from './employeeProfile.controller';
import { logAudit } from '../utils/audit';

export async function getArchivedEmployeeProfile(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const id = String(req.params.id);

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }

  const [{ data: record }, { data: school }] = await Promise.all([
    supabase.from('archived_employees').select('*').eq('id', id).eq('school_id', schoolId).single(),
    supabase.from('schools').select('name, logo_url').eq('id', schoolId).single(),
  ]);
  if (!record) { res.status(404).json({ error: 'Archived record not found' }); return; }

  const hrOfficer = await isHrOfficer(userId);

  const [{ documents }, wave2] = await Promise.all([
    loadDocuments('archived_employees', id, schoolId, hrOfficer),
    loadWave2Bundle('archived_employees', id, schoolId, hrOfficer),
  ]);

  await logAudit({
    req,
    entityType: 'archived_employee',
    entityId: id,
    action: 'read',
    after: { _meta: { kind: 'profile_view', hrOfficer } },
    label: 'archived_profile_view',
  });

  res.json({
    record: toCC(record),
    school: { name: (school?.name as string) ?? 'School', logoUrl: (school?.logo_url as string) ?? null },
    hrOfficer,
    documents,
    extendedProfile: wave2.extendedProfile,
    emergencyContacts: wave2.emergencyContacts,
    acknowledgements: wave2.acknowledgements,
    actions: wave2.actions,
  });
}
