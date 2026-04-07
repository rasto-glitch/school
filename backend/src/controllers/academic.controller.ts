import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';

// ── helpers ──────────────────────────────────────────────────────────────────

async function getTeacherId(userId: string): Promise<string | null> {
  const { data } = await supabase.from('teachers').select('id').eq('user_id', userId).single();
  return data?.id ?? null;
}

async function getParentClassIds(userId: string): Promise<string[]> {
  const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).single();
  if (!parent) return [];
  const { data: students } = await supabase.from('students').select('class_id').eq('parent_id', parent.id);
  return (students ?? []).map((s: any) => s.class_id).filter(Boolean);
}

// ── ACADEMIC POSTS ────────────────────────────────────────────────────────────

export async function getPosts(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { classId } = req.query as { classId?: string };

  try {
    let query = supabase
      .from('academic_posts')
      .select('id, title, subject, content_type, content, attachment_url, attachment_name, image_url, is_published, created_at, updated_at, class_id, teacher_id, classes(name), teachers(full_name, user_id)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (classId) query = query.eq('class_id', classId);

    if (role === 'parent') {
      const classIds = await getParentClassIds(userId);
      if (classIds.length === 0) { res.json([]); return; }
      query = query.in('class_id', classIds).eq('is_published', true);
    } else if (role === 'teacher') {
      const teacherId = await getTeacherId(userId);
      if (!teacherId) { res.json([]); return; }
      // All published + own drafts
      query = query.or(`is_published.eq.true,teacher_id.eq.${teacherId}`);
    } else {
      // admin, supervisor — published only
      query = query.eq('is_published', true);
    }

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
}

export async function getPost(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { id } = req.params;

  try {
    const { data: post, error } = await supabase
      .from('academic_posts')
      .select('*, classes(name), teachers(full_name, user_id)')
      .eq('id', id)
      .eq('school_id', schoolId)
      .single();

    if (error || !post) { res.status(404).json({ error: 'Post not found' }); return; }

    // Parents can only read published posts from their child's class
    if (role === 'parent') {
      if (!post.is_published) { res.status(403).json({ error: 'Forbidden' }); return; }
      const classIds = await getParentClassIds(userId);
      if (!classIds.includes(post.class_id)) { res.status(403).json({ error: 'Forbidden' }); return; }
    }

    // Teachers can read their own drafts; all other published posts
    if (role === 'teacher' && !post.is_published) {
      const teacherId = await getTeacherId(userId);
      if (post.teacher_id !== teacherId) { res.status(403).json({ error: 'Forbidden' }); return; }
    }

    res.json(post);
  } catch {
    res.status(500).json({ error: 'Failed to fetch post' });
  }
}

export async function createPost(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { title, subject, classId, content, contentType, isPublished, imageUrl } = req.body;

  if (!title || !classId || !contentType) {
    res.status(400).json({ error: 'title, classId, contentType are required' });
    return;
  }

  try {
    const teacherId = await getTeacherId(userId);
    if (!teacherId) { res.status(403).json({ error: 'Teacher record not found' }); return; }

    const { data, error } = await supabase
      .from('academic_posts')
      .insert({
        school_id: schoolId,
        teacher_id: teacherId,
        class_id: classId,
        title,
        subject: subject || null,
        content: content || null,
        content_type: contentType,
        image_url: imageUrl || null,
        is_published: isPublished === true,
        updated_at: new Date().toISOString(),
      })
      .select('*, classes(name), teachers(full_name)')
      .single();

    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: 'Failed to create post' });
  }
}

export async function updatePost(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id } = req.params;
  const { title, subject, classId, content, contentType, isPublished, imageUrl } = req.body;

  try {
    const teacherId = await getTeacherId(userId);
    if (!teacherId) { res.status(403).json({ error: 'Forbidden' }); return; }

    // Verify ownership
    const { data: existing } = await supabase
      .from('academic_posts')
      .select('teacher_id')
      .eq('id', id)
      .eq('school_id', schoolId)
      .single();

    if (!existing || existing.teacher_id !== teacherId) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (subject !== undefined) updates.subject = subject;
    if (classId !== undefined) updates.class_id = classId;
    if (content !== undefined) updates.content = content;
    if (contentType !== undefined) updates.content_type = contentType;
    if (isPublished !== undefined) updates.is_published = isPublished;
    if (imageUrl !== undefined) updates.image_url = imageUrl;

    const { data, error } = await supabase
      .from('academic_posts')
      .update(updates)
      .eq('id', id)
      .select('*, classes(name), teachers(full_name)')
      .single();

    if (error) { res.status(400).json({ error: error.message }); return; }
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to update post' });
  }
}

export async function deletePost(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { id } = req.params;

  try {
    if (role === 'teacher') {
      const teacherId = await getTeacherId(userId);
      const { data: existing } = await supabase
        .from('academic_posts')
        .select('teacher_id')
        .eq('id', id)
        .eq('school_id', schoolId)
        .single();
      if (!existing || existing.teacher_id !== teacherId) {
        res.status(403).json({ error: 'Forbidden' }); return;
      }
    }

    const { error } = await supabase
      .from('academic_posts')
      .delete()
      .eq('id', id)
      .eq('school_id', schoolId);

    if (error) { res.status(400).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete post' });
  }
}

export async function uploadPostFile(req: AuthRequest, res: Response): Promise<void> {
  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: 'No file provided' }); return; }

  const ext = file.originalname.split('.').pop();
  const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments')
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const { data: { publicUrl } } = supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments').getPublicUrl(path);
  res.json({ url: publicUrl, name: file.originalname });
}

export async function getClasses(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;

  try {
    if (role === 'teacher') {
      const teacherId = await getTeacherId(userId);
      const { data } = await supabase
        .from('teacher_classes')
        .select('class_id, classes(id, name, grade_level)')
        .eq('teacher_id', teacherId!);
      res.json((data ?? []).map((r: any) => r.classes).filter(Boolean));
    } else if (role === 'parent') {
      const classIds = await getParentClassIds(userId);
      if (classIds.length === 0) { res.json([]); return; }
      const { data } = await supabase
        .from('classes')
        .select('id, name, grade_level')
        .in('id', classIds)
        .order('name');
      res.json(data ?? []);
    } else {
      const { data } = await supabase
        .from('classes')
        .select('id, name, grade_level')
        .eq('school_id', schoolId)
        .order('name');
      res.json(data ?? []);
    }
  } catch {
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
}

// ── E-BOOKS ───────────────────────────────────────────────────────────────────

export async function getEbooks(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;

  try {
    let query = supabase
      .from('ebooks')
      .select('*, classes(name)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (role === 'parent') {
      const classIds = await getParentClassIds(userId);
      // Show ebooks for child's class OR school-wide (null class_id)
      if (classIds.length > 0) {
        query = query.or(`class_id.in.(${classIds.join(',')}),class_id.is.null`);
      } else {
        query = query.is('class_id', null);
      }
    }

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch {
    res.status(500).json({ error: 'Failed to fetch e-books' });
  }
}

export async function uploadEbook(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { title, subject, author, description, classId } = req.body;
  const file = (req as any).file;

  if (!title || !file) { res.status(400).json({ error: 'title and file are required' }); return; }

  try {
    const ext = file.originalname.split('.').pop();
    const path = `ebooks/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';

    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

    if (uploadErr) { res.status(500).json({ error: uploadErr.message }); return; }

    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);

    const { data, error } = await supabase
      .from('ebooks')
      .insert({
        school_id: schoolId,
        class_id: classId || null,
        title,
        subject: subject || null,
        author: author || null,
        description: description || null,
        file_url: publicUrl,
        uploaded_by: userId,
      })
      .select('*, classes(name)')
      .single();

    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: 'Failed to upload e-book' });
  }
}

export async function deleteEbook(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const { error } = await supabase.from('ebooks').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(400).json({ error: error.message }); return; }
  res.json({ success: true });
}
