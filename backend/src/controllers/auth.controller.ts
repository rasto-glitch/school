import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { toCC } from '../utils/transform';

export async function getSchools(_req: Request, res: Response): Promise<void> {
  const { data, error } = await supabase
    .from('schools')
    .select('id, name, slug, logo_url, primary_color')
    .eq('is_active', true)
    .order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function login(req: Request, res: Response): Promise<void> {
  const { username, password, schoolSlug } = req.body;

  if (!username || !password || !schoolSlug) {
    res.status(400).json({ error: 'username, password and schoolSlug are required' });
    return;
  }

  // Find school
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .select('id, name, slug, logo_url, primary_color, secondary_color')
    .eq('slug', schoolSlug)
    .eq('is_active', true)
    .single();

  if (schoolErr || !school) {
    res.status(404).json({ error: 'School not found' });
    return;
  }

  // Find user
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, username, password_hash, role, first_name, last_name, profile_picture, is_active')
    .eq('school_id', school.id)
    .eq('username', username)
    .single();

  if (userErr || !user || !user.is_active) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const payload = {
    userId: user.id,
    schoolId: school.id,
    role: user.role,
    username: user.username,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  } as jwt.SignOptions);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      profilePicture: user.profile_picture,
    },
    school: {
      id: school.id,
      name: school.name,
      slug: school.slug,
      logoUrl: school.logo_url,
      primaryColor: school.primary_color,
      secondaryColor: school.secondary_color,
    },
  });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { username, schoolSlug } = req.body;
  if (!username || !schoolSlug) {
    res.status(400).json({ error: 'username and schoolSlug are required' });
    return;
  }

  const { data: school } = await supabase
    .from('schools').select('id').eq('slug', schoolSlug).eq('is_active', true).single();
  if (!school) { res.status(404).json({ error: 'School not found' }); return; }

  const { data: user } = await supabase
    .from('users').select('id, first_name, last_name')
    .eq('school_id', school.id).eq('username', username).single();

  // Always return success to avoid username enumeration
  if (user) {
    // Remove any existing pending requests before inserting a fresh one (prevents duplicates)
    await supabase.from('password_reset_requests')
      .delete()
      .eq('user_id', user.id)
      .eq('school_id', school.id)
      .eq('status', 'pending');

    await supabase.from('password_reset_requests').insert({
      school_id: school.id,
      user_id: user.id,
      username,
      full_name: `${user.first_name} ${user.last_name}`.trim(),
      status: 'pending',
    });
  }

  res.json({ message: 'If this username exists, a reset request has been submitted to your school administrator.' });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body;
  const userId = (req as any).user?.userId;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword required' });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters' });
    return;
  }

  const { data: user } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', userId)
    .single();

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const newHash = await bcrypt.hash(newPassword, rounds);

  await supabase.from('users').update({ password_hash: newHash }).eq('id', userId);

  res.json({ message: 'Password changed successfully' });
}
