import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/schools — list all schools with counts
router.get('/', async (_req: Request, res: Response) => {
  const { data: schools, error } = await supabase
    .from('schools')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const schoolsWithCounts = await Promise.all((schools || []).map(async (school) => {
    const [{ count: studentCount }, { count: adminCount }, { count: userCount }] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', school.id),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('school_id', school.id).eq('role', 'admin'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('school_id', school.id),
    ]);
    return {
      ...school,
      studentCount: studentCount ?? 0,
      adminCount: adminCount ?? 0,
      userCount: userCount ?? 0,
    };
  }));

  res.json(schoolsWithCounts);
});

// POST /api/schools — create school + seed admin account
router.post('/', async (req: Request, res: Response) => {
  const {
    name, slug, primaryColor, secondaryColor, domain, subscriptionPlan,
    adminFirstName, adminLastName, adminUsername, adminPassword, adminEmail,
  } = req.body;

  if (!name || !slug || !adminFirstName || !adminLastName || !adminUsername || !adminPassword) {
    res.status(400).json({ error: 'name, slug, adminFirstName, adminLastName, adminUsername, adminPassword are required' });
    return;
  }

  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .insert({
      name,
      slug,
      primary_color: primaryColor || '#4F46E5',
      secondary_color: secondaryColor || '#06B6D4',
      domain: domain || null,
      subscription_plan: subscriptionPlan || 'basic',
      is_active: true,
    })
    .select()
    .single();

  if (schoolErr) { res.status(400).json({ error: schoolErr.message }); return; }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const { error: userErr } = await supabase.from('users').insert({
    school_id: school.id,
    email: adminEmail || null,
    username: adminUsername,
    password_hash: passwordHash,
    role: 'admin',
    first_name: adminFirstName,
    last_name: adminLastName,
    is_active: true,
  });

  if (userErr) {
    await supabase.from('schools').delete().eq('id', school.id);
    res.status(400).json({ error: userErr.message });
    return;
  }

  res.status(201).json(school);
});

// PUT /api/schools/:id — edit school details
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, slug, primaryColor, secondaryColor, domain, subscriptionPlan } = req.body;

  const { data, error } = await supabase
    .from('schools')
    .update({
      name,
      slug,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      domain: domain || null,
      subscription_plan: subscriptionPlan,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) { res.status(400).json({ error: error.message }); return; }
  res.json(data);
});

// PATCH /api/schools/:id/status — activate or deactivate
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { isActive } = req.body;

  const { data, error } = await supabase
    .from('schools')
    .update({ is_active: isActive })
    .eq('id', id)
    .select()
    .single();

  if (error) { res.status(400).json({ error: error.message }); return; }
  res.json(data);
});

// PATCH /api/schools/:id/admin-password — reset admin account(s) password
router.patch('/:id/admin-password', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('school_id', id)
    .eq('role', 'admin');

  if (error) { res.status(400).json({ error: error.message }); return; }
  res.json({ message: 'Admin password updated.' });
});

// DELETE /api/schools/:id — permanently delete (cascades via FK)
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { error } = await supabase.from('schools').delete().eq('id', id);
  if (error) { res.status(400).json({ error: error.message }); return; }
  res.json({ message: 'School deleted' });
});

export default router;
