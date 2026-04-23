import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { notifyMany } from '../utils/notify';

// ── helpers ──────────────────────────────────────────────────────────────────

async function getTeacherId(userId: string): Promise<string | null> {
  const { data } = await supabase.from('teachers').select('id').eq('user_id', userId).single();
  return data?.id ?? null;
}

async function getTeacherInfo(userId: string): Promise<{ id: string; fullName: string; subject: string | null } | null> {
  const { data } = await supabase.from('teachers').select('id, full_name, subject').eq('user_id', userId).single();
  if (!data) return null;
  return { id: data.id, fullName: data.full_name, subject: data.subject ?? null };
}

async function getParentClassIds(userId: string): Promise<string[]> {
  const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).single();
  if (!parent) return [];
  const { data: students } = await supabase.from('students').select('class_id').eq('parent_id', parent.id);
  return (students ?? []).map((s: any) => s.class_id).filter(Boolean);
}

async function getUserName(userId: string): Promise<string> {
  const { data } = await supabase.from('users').select('first_name, last_name').eq('id', userId).single();
  if (!data) return '';
  return `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim();
}

async function decoratePosts(posts: any[], viewerUserId: string): Promise<any[]> {
  if (posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);

  const [likesRes, savesRes, commentsRes, myLikesRes, mySavesRes] = await Promise.all([
    supabase.from('post_likes').select('post_id').in('post_id', postIds),
    supabase.from('post_saves').select('post_id').in('post_id', postIds),
    supabase.from('post_comments').select('post_id').in('post_id', postIds).eq('is_deleted', false),
    supabase.from('post_likes').select('post_id').in('post_id', postIds).eq('user_id', viewerUserId),
    supabase.from('post_saves').select('post_id').in('post_id', postIds).eq('user_id', viewerUserId),
  ]);

  const likesCount: Record<string, number> = {};
  (likesRes.data ?? []).forEach((r: any) => { likesCount[r.post_id] = (likesCount[r.post_id] ?? 0) + 1; });
  const savesCount: Record<string, number> = {};
  (savesRes.data ?? []).forEach((r: any) => { savesCount[r.post_id] = (savesCount[r.post_id] ?? 0) + 1; });
  const commentsCount: Record<string, number> = {};
  (commentsRes.data ?? []).forEach((r: any) => { commentsCount[r.post_id] = (commentsCount[r.post_id] ?? 0) + 1; });
  const liked = new Set((myLikesRes.data ?? []).map((r: any) => r.post_id));
  const saved = new Set((mySavesRes.data ?? []).map((r: any) => r.post_id));

  // Resolve author display for supervisor posts (teachers come from join)
  const supervisorAuthorIds = Array.from(new Set(
    posts.filter((p) => p.author_role === 'supervisor' && p.author_user_id).map((p) => p.author_user_id)
  ));
  const supervisorNames: Record<string, string> = {};
  if (supervisorAuthorIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .in('id', supervisorAuthorIds);
    (users ?? []).forEach((u: any) => {
      supervisorNames[u.id] = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    });
  }

  return posts.map((p) => {
    let authorName = '';
    let authorSubject: string | null = null;
    if (p.author_role === 'teacher') {
      authorName = p.teachers?.full_name ?? '';
      authorSubject = p.subject ?? p.teachers?.subject ?? null;
    } else if (p.author_role === 'supervisor') {
      authorName = supervisorNames[p.author_user_id] ?? '';
    }
    return {
      ...p,
      author_name: authorName,
      author_subject: authorSubject,
      likes_count: likesCount[p.id] ?? 0,
      saves_count: savesCount[p.id] ?? 0,
      comments_count: commentsCount[p.id] ?? 0,
      liked_by_me: liked.has(p.id),
      saved_by_me: saved.has(p.id),
    };
  });
}

// ── ACADEMIC POSTS ────────────────────────────────────────────────────────────

export async function getPosts(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { classId } = req.query as { classId?: string };

  try {
    const baseSelect = 'id, title, subject, body, content_type, content, attachment_url, attachment_name, image_url, is_published, created_at, updated_at, class_id, teacher_id, author_user_id, author_role, classes(name), teachers(full_name, subject, user_id)';

    if (role === 'parent') {
      const classIds = await getParentClassIds(userId);
      // Teacher posts for child classes + school-wide supervisor posts
      const teacherPosts = classIds.length > 0 ? supabase
        .from('academic_posts')
        .select(baseSelect)
        .eq('school_id', schoolId)
        .eq('is_published', true)
        .eq('author_role', 'teacher')
        .in('class_id', classIds) : null;
      const supervisorPosts = supabase
        .from('academic_posts')
        .select(baseSelect)
        .eq('school_id', schoolId)
        .eq('is_published', true)
        .eq('author_role', 'supervisor');

      const [tRes, sRes] = await Promise.all([
        teacherPosts ?? Promise.resolve({ data: [] as any[], error: null }),
        supervisorPosts,
      ]);
      if (tRes.error || sRes.error) {
        res.status(500).json({ error: tRes.error?.message ?? sRes.error?.message });
        return;
      }
      const merged = [...(tRes.data ?? []), ...(sRes.data ?? [])].sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const decorated = await decoratePosts(merged, userId);
      res.json(decorated);
      return;
    }

    let query = supabase
      .from('academic_posts')
      .select(baseSelect)
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (classId) query = query.eq('class_id', classId);

    if (role === 'teacher') {
      const teacherId = await getTeacherId(userId);
      if (!teacherId) { res.json([]); return; }
      query = query.or(`is_published.eq.true,and(author_user_id.eq.${userId},author_role.eq.teacher)`);
    } else if (role === 'supervisor') {
      // Supervisors see all published + their own drafts
      query = query.or(`is_published.eq.true,and(author_user_id.eq.${userId},author_role.eq.supervisor)`);
    } else {
      query = query.eq('is_published', true);
    }

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    const decorated = await decoratePosts(data ?? [], userId);
    res.json(decorated);
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
      .select('*, classes(name), teachers(full_name, subject, user_id)')
      .eq('id', id)
      .eq('school_id', schoolId)
      .single();

    if (error || !post) { res.status(404).json({ error: 'Post not found' }); return; }

    if (role === 'parent') {
      if (!post.is_published) { res.status(403).json({ error: 'Forbidden' }); return; }
      if (post.author_role === 'teacher') {
        const classIds = await getParentClassIds(userId);
        if (!classIds.includes(post.class_id)) { res.status(403).json({ error: 'Forbidden' }); return; }
      }
    }

    if (!post.is_published && post.author_user_id !== userId && role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const decorated = await decoratePosts([post], userId);
    res.json(decorated[0]);
  } catch {
    res.status(500).json({ error: 'Failed to fetch post' });
  }
}

export async function createPost(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { title, subject, classId, content, body, contentType, isPublished, imageUrl } = req.body;

  if (!title || !contentType) {
    res.status(400).json({ error: 'title and contentType are required' });
    return;
  }

  try {
    if (role === 'teacher') {
      const info = await getTeacherInfo(userId);
      if (!info) { res.status(403).json({ error: 'Teacher record not found' }); return; }
      if (!classId) { res.status(400).json({ error: 'classId required for teacher posts' }); return; }

      const { data, error } = await supabase
        .from('academic_posts')
        .insert({
          school_id: schoolId,
          teacher_id: info.id,
          class_id: classId,
          author_user_id: userId,
          author_role: 'teacher',
          title,
          subject: subject || info.subject || null,
          content: content || null,
          body: body || null,
          content_type: contentType,
          image_url: imageUrl || null,
          is_published: isPublished === true,
          updated_at: new Date().toISOString(),
        })
        .select('*, classes(name), teachers(full_name, subject, user_id)')
        .single();

      if (error) { res.status(400).json({ error: error.message }); return; }

      // Notify parents of students in this class when the post is published.
      if (data.is_published && classId) {
        const { data: students } = await supabase
          .from('students')
          .select('parents(user_id)')
          .eq('class_id', classId)
          .eq('school_id', schoolId);
        if (students) {
          const uniqueParentIds = new Set<string>();
          for (const s of students as any[]) {
            const uid = s.parents?.user_id;
            if (uid) uniqueParentIds.add(uid);
          }
          const payloads = Array.from(uniqueParentIds).map(uid => ({
            schoolId,
            userId: uid,
            title: 'New Post',
            message: title,
            type: 'post',
            relatedId: data.id,
          }));
          notifyMany(payloads).catch(() => {});
        }
      }

      const decorated = await decoratePosts([data], userId);
      res.status(201).json(decorated[0]);
      return;
    }

    if (role === 'supervisor') {
      const { data, error } = await supabase
        .from('academic_posts')
        .insert({
          school_id: schoolId,
          teacher_id: null,
          class_id: null,
          author_user_id: userId,
          author_role: 'supervisor',
          title,
          subject: subject || null,
          content: content || null,
          body: body || null,
          content_type: contentType,
          image_url: imageUrl || null,
          is_published: isPublished === true,
          updated_at: new Date().toISOString(),
        })
        .select('*, classes(name), teachers(full_name, subject, user_id)')
        .single();

      if (error) { res.status(400).json({ error: error.message }); return; }

      // Supervisor posts are school-wide; notify every parent in the school.
      if (data.is_published) {
        const { data: parentUsers } = await supabase
          .from('users')
          .select('id')
          .eq('school_id', schoolId)
          .eq('role', 'parent')
          .eq('is_active', true);
        if (parentUsers && parentUsers.length > 0) {
          const payloads = parentUsers.map((u: { id: string }) => ({
            schoolId,
            userId: u.id,
            title: 'New Post',
            message: title,
            type: 'post',
            relatedId: data.id,
          }));
          notifyMany(payloads).catch(() => {});
        }
      }

      const decorated = await decoratePosts([data], userId);
      res.status(201).json(decorated[0]);
      return;
    }

    res.status(403).json({ error: 'Only teachers and supervisors can create posts' });
  } catch {
    res.status(500).json({ error: 'Failed to create post' });
  }
}

export async function updatePost(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id } = req.params;
  const { title, subject, classId, content, body, contentType, isPublished, imageUrl } = req.body;

  try {
    const { data: existing } = await supabase
      .from('academic_posts')
      .select('author_user_id, author_role')
      .eq('id', id)
      .eq('school_id', schoolId)
      .single();

    if (!existing || existing.author_user_id !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (subject !== undefined) updates.subject = subject;
    if (classId !== undefined && existing.author_role === 'teacher') updates.class_id = classId;
    if (content !== undefined) updates.content = content;
    if (body !== undefined) updates.body = body;
    if (contentType !== undefined) updates.content_type = contentType;
    if (isPublished !== undefined) updates.is_published = isPublished;
    if (imageUrl !== undefined) updates.image_url = imageUrl;

    const { data, error } = await supabase
      .from('academic_posts')
      .update(updates)
      .eq('id', id)
      .select('*, classes(name), teachers(full_name, subject, user_id)')
      .single();

    if (error) { res.status(400).json({ error: error.message }); return; }
    const decorated = await decoratePosts([data], userId);
    res.json(decorated[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update post' });
  }
}

export async function deletePost(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { id } = req.params;

  try {
    if (role !== 'admin') {
      const { data: existing } = await supabase
        .from('academic_posts')
        .select('author_user_id')
        .eq('id', id)
        .eq('school_id', schoolId)
        .single();
      if (!existing || existing.author_user_id !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
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

// ── LIKES ─────────────────────────────────────────────────────────────────────

export async function toggleLike(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: postId } = req.params;

  try {
    const { data: existing } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await supabase.from('post_likes').delete().eq('id', existing.id);
      const { count } = await supabase.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
      res.json({ liked: false, likesCount: count ?? 0 });
      return;
    }

    const { error } = await supabase
      .from('post_likes')
      .insert({ school_id: schoolId, post_id: postId, user_id: userId });
    if (error) { res.status(400).json({ error: error.message }); return; }

    const { count } = await supabase.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
    res.json({ liked: true, likesCount: count ?? 0 });
  } catch {
    res.status(500).json({ error: 'Failed to toggle like' });
  }
}

// ── SAVES ─────────────────────────────────────────────────────────────────────

export async function toggleSave(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: postId } = req.params;

  try {
    const { data: existing } = await supabase
      .from('post_saves')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await supabase.from('post_saves').delete().eq('id', existing.id);
      res.json({ saved: false });
      return;
    }

    const { error } = await supabase
      .from('post_saves')
      .insert({ school_id: schoolId, post_id: postId, user_id: userId });
    if (error) { res.status(400).json({ error: error.message }); return; }

    res.json({ saved: true });
  } catch {
    res.status(500).json({ error: 'Failed to toggle save' });
  }
}

export async function getSavedPosts(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;

  try {
    const { data: saves } = await supabase
      .from('post_saves')
      .select('post_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const postIds = (saves ?? []).map((s: any) => s.post_id);
    if (postIds.length === 0) { res.json([]); return; }

    const { data: posts } = await supabase
      .from('academic_posts')
      .select('id, title, subject, body, content_type, content, attachment_url, attachment_name, image_url, is_published, created_at, updated_at, class_id, teacher_id, author_user_id, author_role, classes(name), teachers(full_name, subject, user_id)')
      .in('id', postIds)
      .eq('school_id', schoolId);

    // Preserve save order
    const byId = new Map((posts ?? []).map((p: any) => [p.id, p]));
    const ordered = postIds.map((id) => byId.get(id)).filter(Boolean) as any[];
    const decorated = await decoratePosts(ordered, userId);
    res.json(decorated);
  } catch {
    res.status(500).json({ error: 'Failed to fetch saved posts' });
  }
}

// ── COMMENTS ──────────────────────────────────────────────────────────────────

export async function getComments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id: postId } = req.params;

  try {
    const { data, error } = await supabase
      .from('post_comments')
      .select('id, post_id, user_id, body, created_at, users(first_name, last_name, role, profile_picture)')
      .eq('post_id', postId)
      .eq('school_id', schoolId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
}

export async function createComment(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: postId } = req.params;
  const { body } = req.body;

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    res.status(400).json({ error: 'Comment body required' });
    return;
  }

  try {
    const { data, error } = await supabase
      .from('post_comments')
      .insert({ school_id: schoolId, post_id: postId, user_id: userId, body: body.trim() })
      .select('id, post_id, user_id, body, created_at, users(first_name, last_name, role, profile_picture)')
      .single();

    if (error) { res.status(400).json({ error: error.message }); return; }
    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: 'Failed to create comment' });
  }
}

export async function deleteComment(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { commentId } = req.params;

  try {
    const { data: existing } = await supabase
      .from('post_comments')
      .select('user_id')
      .eq('id', commentId)
      .eq('school_id', schoolId)
      .single();

    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    if (existing.user_id !== userId && role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { error } = await supabase
      .from('post_comments')
      .update({ is_deleted: true })
      .eq('id', commentId);

    if (error) { res.status(400).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete comment' });
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

// ── EBOOK PROGRESS ────────────────────────────────────────────────────────────

export async function getEbookProgress(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { ebookId, studentId } = req.query as { ebookId?: string; studentId?: string };

  try {
    let query = supabase
      .from('ebook_progress')
      .select('id, ebook_id, student_id, current_page, total_pages, percent, updated_at, students(full_name)')
      .eq('school_id', schoolId);

    if (ebookId) query = query.eq('ebook_id', ebookId);

    if (role === 'parent') {
      const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).single();
      if (!parent) { res.json([]); return; }
      const { data: students } = await supabase.from('students').select('id').eq('parent_id', parent.id);
      const ids = (students ?? []).map((s: any) => s.id);
      if (ids.length === 0) { res.json([]); return; }
      query = query.in('student_id', ids);
    }

    if (studentId) query = query.eq('student_id', studentId);

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch {
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
}

export async function upsertEbookProgress(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { ebookId, studentId, currentPage, totalPages } = req.body;

  if (!ebookId || !studentId || currentPage === undefined) {
    res.status(400).json({ error: 'ebookId, studentId, currentPage required' });
    return;
  }

  try {
    // Parents can only update their own children's progress
    if (role === 'parent') {
      const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).single();
      if (!parent) { res.status(403).json({ error: 'Forbidden' }); return; }
      const { data: student } = await supabase.from('students').select('id').eq('id', studentId).eq('parent_id', parent.id).maybeSingle();
      if (!student) { res.status(403).json({ error: 'Forbidden' }); return; }
    }

    const percent = totalPages && totalPages > 0
      ? Math.min(100, Math.max(0, Math.round((currentPage / totalPages) * 10000) / 100))
      : 0;

    const { data, error } = await supabase
      .from('ebook_progress')
      .upsert({
        school_id: schoolId,
        student_id: studentId,
        ebook_id: ebookId,
        current_page: currentPage,
        total_pages: totalPages ?? null,
        percent,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'student_id,ebook_id' })
      .select()
      .single();

    if (error) { res.status(400).json({ error: error.message }); return; }
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to save progress' });
  }
}
