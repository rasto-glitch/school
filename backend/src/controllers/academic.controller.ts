import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
import { safeExt } from '../utils/upload';
import type { AuthRequest } from '../middleware/auth';
import { notifyMany } from '../utils/notify';
import { subjectAllowedForClass } from '../utils/curriculum';
import { parseCursorParams, buildPage } from '../utils/pagination';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── helpers ──────────────────────────────────────────────────────────────────

async function getTeacherId(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.from('teachers').select('id').eq('user_id', userId).single();
  return data?.id ?? null;
}

async function getTeacherInfo(db: SupabaseClient, userId: string): Promise<{ id: string; fullName: string; subject: string | null } | null> {
  const { data } = await db.from('teachers').select('id, full_name, subject').eq('user_id', userId).single();
  if (!data) return null;
  return { id: data.id, fullName: data.full_name, subject: data.subject ?? null };
}

async function getParentClassIds(db: SupabaseClient, userId: string): Promise<string[]> {
  const { data: parent } = await db.from('parents').select('id').eq('user_id', userId).single();
  if (!parent) return [];
  const { data: students } = await db.from('students').select('class_id').eq('parent_id', parent.id);
  return (students ?? []).map((s: any) => s.class_id).filter(Boolean);
}

// Fires post-publish notifications for a newly visible post. Teacher posts
// reach only parents of students in that class; supervisor posts reach every
// parent in the school.
async function notifyPostAudience(
  db: SupabaseClient,
  schoolId: string,
  post: { id: string; author_role: string | null; class_id: string | null; author_user_id: string | null },
  title: string,
): Promise<void> {
  let userIds: string[] = [];

  if (post.author_role === 'teacher') {
    if (!post.class_id) return;
    // Two-step lookup so the FK auto-detection between students and parents
    // doesn't matter: collect parent_ids from students in the class, then
    // resolve their user_ids.
    const { data: students } = await db
      .from('students')
      .select('parent_id')
      .eq('class_id', post.class_id)
      .eq('school_id', schoolId);
    const parentIds = Array.from(new Set(((students ?? []) as any[]).map(s => s.parent_id).filter(Boolean)));
    if (parentIds.length === 0) return;
    const { data: parents } = await db
      .from('parents')
      .select('user_id')
      .in('id', parentIds);
    userIds = Array.from(new Set(((parents ?? []) as any[]).map(p => p.user_id).filter(Boolean)));
  } else if (post.author_role === 'supervisor') {
    const { data: parentUsers } = await db
      .from('users')
      .select('id')
      .eq('school_id', schoolId)
      .eq('role', 'parent')
      .eq('is_active', true);
    userIds = (parentUsers ?? []).map((u: { id: string }) => u.id);
  } else {
    return;
  }

  // Don't notify the author about their own post.
  if (post.author_user_id) {
    userIds = userIds.filter(uid => uid !== post.author_user_id);
  }

  if (userIds.length === 0) return;
  const payloads = userIds.map(uid => ({
    schoolId,
    userId: uid,
    title: 'New Post',
    message: title,
    type: 'post',
    relatedId: post.id,
  }));
  notifyMany(payloads).catch(() => {});
}

async function decoratePosts(db: SupabaseClient, posts: any[], viewerUserId: string): Promise<any[]> {
  if (posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);

  const [likesRes, savesRes, commentsRes, myLikesRes, mySavesRes] = await Promise.all([
    db.from('post_likes').select('post_id').in('post_id', postIds),
    db.from('post_saves').select('post_id').in('post_id', postIds),
    db.from('post_comments').select('post_id').in('post_id', postIds).eq('is_deleted', false),
    db.from('post_likes').select('post_id').in('post_id', postIds).eq('user_id', viewerUserId),
    db.from('post_saves').select('post_id').in('post_id', postIds).eq('user_id', viewerUserId),
  ]);

  const likesCount: Record<string, number> = {};
  (likesRes.data ?? []).forEach((r: any) => { likesCount[r.post_id] = (likesCount[r.post_id] ?? 0) + 1; });
  const savesCount: Record<string, number> = {};
  (savesRes.data ?? []).forEach((r: any) => { savesCount[r.post_id] = (savesCount[r.post_id] ?? 0) + 1; });
  const commentsCount: Record<string, number> = {};
  (commentsRes.data ?? []).forEach((r: any) => { commentsCount[r.post_id] = (commentsCount[r.post_id] ?? 0) + 1; });
  const liked = new Set((myLikesRes.data ?? []).map((r: any) => r.post_id));
  const saved = new Set((mySavesRes.data ?? []).map((r: any) => r.post_id));

  // Resolve author display + profile picture for every author. Teachers'
  // teachers.full_name comes from the join, but the avatar lives on users.
  const authorUserIds = Array.from(new Set(
    posts.map((p) => p.author_user_id).filter(Boolean)
  ));
  const authorNames: Record<string, string> = {};
  const authorAvatars: Record<string, string | null> = {};
  if (authorUserIds.length > 0) {
    const { data: users } = await db
      .from('users')
      .select('id, first_name, last_name, profile_picture')
      .in('id', authorUserIds);
    (users ?? []).forEach((u: any) => {
      authorNames[u.id] = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
      authorAvatars[u.id] = u.profile_picture ?? null;
    });
  }

  return posts.map((p) => {
    let authorName = '';
    let authorSubject: string | null = null;
    if (p.author_role === 'teacher') {
      authorName = p.teachers?.full_name ?? '';
      authorSubject = p.subject ?? p.teachers?.subject ?? null;
    } else if (p.author_role === 'supervisor') {
      authorName = authorNames[p.author_user_id] ?? '';
    }
    return {
      ...p,
      author_name: authorName,
      author_subject: authorSubject,
      author_avatar: p.author_user_id ? (authorAvatars[p.author_user_id] ?? null) : null,
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
  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  // Server-side search + "my posts" so filtering is correct at any scale
  // (not limited to the pages a client has scrolled into memory).
  const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  // Strip PostgREST-significant chars so a search term can't break the
  // .or() filter grammar (commas / parens / wildcards).
  const q = rawQ.replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
  const mine = req.query.mine === '1' || req.query.mine === 'true';

  // Composite-keyset predicate ("older than the cursor row"), AND-ed as its
  // own OR-group alongside any role/class OR-group.
  const cursorClause = cursor
    ? `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    : null;

  try {
    const baseSelect = 'id, title, subject, body, content_type, content, attachment_url, attachment_name, image_url, is_published, created_at, updated_at, class_id, teacher_id, author_user_id, author_role, classes(name), teachers(full_name, subject, user_id)';

    let query = req.db!
      .from('academic_posts')
      .select(baseSelect)
      .eq('school_id', schoolId);

    if (mine) {
      // "My posts" — only the caller's own, including their own drafts.
      // Server-side so it's correct regardless of how far the client paged.
      query = query.eq('author_user_id', userId);
      if (classId) query = query.eq('class_id', classId);
    } else if (role === 'parent') {
      // Collapsed union: published supervisor posts (school-wide) OR
      // published teacher posts for the child's classes — one keyset query
      // instead of two merged in memory.
      const classIds = await getParentClassIds(req.db!, userId);
      query = query.eq('is_published', true);
      query = classIds.length > 0
        ? query.or(`author_role.eq.supervisor,and(author_role.eq.teacher,class_id.in.(${classIds.join(',')}))`)
        : query.eq('author_role', 'supervisor');
    } else {
      if (classId) query = query.eq('class_id', classId);
      if (role === 'teacher') {
        const teacherId = await getTeacherId(req.db!, userId);
        if (!teacherId) { res.json({ data: [], limit, nextCursor: null }); return; }
        query = query.or(`is_published.eq.true,and(author_user_id.eq.${userId},author_role.eq.teacher)`);
      } else if (role === 'supervisor') {
        query = query.or(`is_published.eq.true,and(author_user_id.eq.${userId},author_role.eq.supervisor)`);
      } else {
        query = query.eq('is_published', true);
      }
    }

    // Free-text search — its own AND-ed OR-group (composes with role/union
    // group + cursor group; PostgREST ANDs separate .or() calls).
    if (q) query = query.or(`title.ilike.%${q}%,subject.ilike.%${q}%`);

    if (cursorClause) query = query.or(cursorClause);

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

    const page = buildPage((data ?? []) as { id: string; created_at: string }[], limit);
    const decorated = await decoratePosts(req.db!,page.data, userId);
    res.json({ data: decorated, limit: page.limit, nextCursor: page.nextCursor });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
}

export async function getPost(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { id } = req.params;

  try {
    const { data: post, error } = await req.db!
      .from('academic_posts')
      .select('*, classes(name), teachers(full_name, subject, user_id)')
      .eq('id', id)
      .eq('school_id', schoolId)
      .single();

    if (error || !post) { res.status(404).json({ error: 'Post not found' }); return; }

    if (role === 'parent') {
      if (!post.is_published) { res.status(403).json({ error: 'Forbidden' }); return; }
      if (post.author_role === 'teacher') {
        const classIds = await getParentClassIds(req.db!, userId);
        if (!classIds.includes(post.class_id)) { res.status(403).json({ error: 'Forbidden' }); return; }
      }
    }

    if (!post.is_published && post.author_user_id !== userId && role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const decorated = await decoratePosts(req.db!,[post], userId);
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
      const info = await getTeacherInfo(req.db!, userId);
      if (!info) { res.status(403).json({ error: 'Teacher record not found' }); return; }
      if (!classId) { res.status(400).json({ error: 'classId required for teacher posts' }); return; }
      if (subject && !(await subjectAllowedForClass(schoolId, info.id, classId, subject))) {
        res.status(403).json({ error: `You aren't assigned to teach ${subject} for this class.` }); return;
      }

      const { data, error } = await req.db!
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

      if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

      if (data.is_published) {
        notifyPostAudience(req.db!, schoolId,data, title);
      }

      const decorated = await decoratePosts(req.db!,[data], userId);
      res.status(201).json(decorated[0]);
      return;
    }

    if (role === 'supervisor') {
      const { data, error } = await req.db!
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

      if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

      if (data.is_published) {
        notifyPostAudience(req.db!, schoolId,data, title);
      }

      const decorated = await decoratePosts(req.db!,[data], userId);
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
    const { data: existing } = await req.db!
      .from('academic_posts')
      .select('author_user_id, author_role, is_published')
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

    const { data, error } = await req.db!
      .from('academic_posts')
      .update(updates)
      .eq('id', id)
      .select('*, classes(name), teachers(full_name, subject, user_id)')
      .single();

    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

    // Notify when a draft becomes visible for the first time.
    if (!existing.is_published && data.is_published) {
      notifyPostAudience(req.db!, schoolId,data, data.title);
    }

    const decorated = await decoratePosts(req.db!,[data], userId);
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
      const { data: existing } = await req.db!
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

    const { error } = await req.db!
      .from('academic_posts')
      .delete()
      .eq('id', id)
      .eq('school_id', schoolId);

    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete post' });
  }
}

export async function uploadPostFile(req: AuthRequest, res: Response): Promise<void> {
  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: 'No file provided' }); return; }

  const ext = safeExt(file.originalname, '.bin');
  const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  const { error } = await req.db!.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments')
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const { data: { publicUrl } } = req.db!.storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments').getPublicUrl(path);
  res.json({ url: publicUrl, name: file.originalname });
}

export async function getClasses(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;

  try {
    if (role === 'teacher') {
      const teacherId = await getTeacherId(req.db!, userId);
      const { data } = await req.db!
        .from('teacher_classes')
        .select('class_id, classes(id, name, grade_level)')
        .eq('teacher_id', teacherId!);
      res.json((data ?? []).map((r: any) => r.classes).filter(Boolean));
    } else if (role === 'parent') {
      const classIds = await getParentClassIds(req.db!, userId);
      if (classIds.length === 0) { res.json([]); return; }
      const { data } = await req.db!
        .from('classes')
        .select('id, name, grade_level')
        .in('id', classIds)
        .order('name');
      res.json(data ?? []);
    } else {
      const { data } = await req.db!
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

// Returns the logged-in author's display info for prefilling post forms.
// For teachers, includes the resolved subject(s) and a per-class subject map ("teaching").
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  try {
    if (role !== 'teacher') {
      res.json({ role, subject: null, subjects: [], teaching: [] });
      return;
    }
    const { data: teacher } = await req.db!
      .from('teachers')
      .select('id, subject, class_subject_teachers(class_id, subject_id, subjects(id, name))')
      .eq('user_id', userId)
      .eq('school_id', schoolId)
      .single();
    if (!teacher) { res.json({ role, subject: null, subjects: [], teaching: [] }); return; }
    const teachingMap = new Map<string, { id: string; name: string }[]>();
    const allSubjects = new Map<string, string>();
    for (const r of (((teacher as any).class_subject_teachers ?? []) as any[])) {
      const sid = r.subject_id, sname = r.subjects?.name;
      if (!sid || !sname) continue;
      allSubjects.set(sid, sname);
      if (r.class_id) {
        const arr = teachingMap.get(r.class_id) ?? [];
        if (!arr.some(s => s.id === sid)) arr.push({ id: sid, name: sname });
        teachingMap.set(r.class_id, arr);
      }
    }
    let subjects = Array.from(allSubjects, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    const teaching = Array.from(teachingMap, ([classId, subs]) => ({ classId, subjects: subs.sort((a, b) => a.name.localeCompare(b.name)) }));
    if (subjects.length === 0 && (teacher as any).subject) {
      subjects = String((teacher as any).subject).split(',').map((n: string) => n.trim()).filter(Boolean).map((name: string) => ({ id: name, name }));
    }
    const resolvedSubject = subjects.map(s => s.name).join(', ') || (teacher as any).subject || null;
    res.json({ role, subject: resolvedSubject, subjects, teaching });
  } catch {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

// ── LIKES ─────────────────────────────────────────────────────────────────────

export async function toggleLike(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: postId } = req.params;

  try {
    const { data: existing } = await req.db!
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await req.db!.from('post_likes').delete().eq('id', existing.id);
      const { count } = await req.db!.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
      res.json({ liked: false, likesCount: count ?? 0 });
      return;
    }

    const { error } = await req.db!
      .from('post_likes')
      .insert({ school_id: schoolId, post_id: postId, user_id: userId });
    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

    const { count } = await req.db!.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
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
    const { data: existing } = await req.db!
      .from('post_saves')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await req.db!.from('post_saves').delete().eq('id', existing.id);
      res.json({ saved: false });
      return;
    }

    const { error } = await req.db!
      .from('post_saves')
      .insert({ school_id: schoolId, post_id: postId, user_id: userId });
    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

    res.json({ saved: true });
  } catch {
    res.status(500).json({ error: 'Failed to toggle save' });
  }
}

export async function getSavedPosts(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;

  try {
    const { data: saves } = await req.db!
      .from('post_saves')
      .select('post_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const postIds = (saves ?? []).map((s: any) => s.post_id);
    if (postIds.length === 0) { res.json([]); return; }

    const { data: posts } = await req.db!
      .from('academic_posts')
      .select('id, title, subject, body, content_type, content, attachment_url, attachment_name, image_url, is_published, created_at, updated_at, class_id, teacher_id, author_user_id, author_role, classes(name), teachers(full_name, subject, user_id)')
      .in('id', postIds)
      .eq('school_id', schoolId);

    // Preserve save order
    const byId = new Map((posts ?? []).map((p: any) => [p.id, p]));
    const ordered = postIds.map((id) => byId.get(id)).filter(Boolean) as any[];
    const decorated = await decoratePosts(req.db!,ordered, userId);
    res.json(decorated);
  } catch {
    res.status(500).json({ error: 'Failed to fetch saved posts' });
  }
}

// ── COMMENTS ──────────────────────────────────────────────────────────────────

export async function getComments(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: postId } = req.params;

  try {
    const { data, error } = await req.db!
      .from('post_comments')
      .select('id, post_id, user_id, parent_id, body, created_at, users(first_name, last_name, role, profile_picture)')
      .eq('post_id', postId)
      .eq('school_id', schoolId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });

    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

    const comments = data ?? [];
    if (comments.length === 0) { res.json([]); return; }

    const ids = comments.map((c: any) => c.id);
    const teacherUserIds = Array.from(new Set(
      comments.filter((c: any) => c.users?.role === 'teacher').map((c: any) => c.user_id)
    ));
    const [likesRes, myLikesRes, subjectsRes] = await Promise.all([
      req.db!.from('post_comment_likes').select('comment_id').in('comment_id', ids),
      req.db!.from('post_comment_likes').select('comment_id').in('comment_id', ids).eq('user_id', userId),
      teacherUserIds.length > 0
        ? req.db!.from('teachers').select('user_id, subject').in('user_id', teacherUserIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const counts: Record<string, number> = {};
    (likesRes.data ?? []).forEach((r: any) => { counts[r.comment_id] = (counts[r.comment_id] ?? 0) + 1; });
    const liked = new Set((myLikesRes.data ?? []).map((r: any) => r.comment_id));
    const subjectByUser: Record<string, string | null> = {};
    ((subjectsRes.data ?? []) as any[]).forEach((t: any) => { subjectByUser[t.user_id] = t.subject ?? null; });

    res.json(comments.map((c: any) => ({
      ...c,
      author_subject: c.users?.role === 'teacher' ? (subjectByUser[c.user_id] ?? null) : null,
      likes_count: counts[c.id] ?? 0,
      liked_by_me: liked.has(c.id),
    })));
  } catch {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
}

export async function createComment(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: postId } = req.params;
  const { body, parentId } = req.body;

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    res.status(400).json({ error: 'Comment body required' });
    return;
  }

  try {
    let resolvedParentId: string | null = null;
    let directParentUserId: string | null = null;
    if (parentId && typeof parentId === 'string') {
      const { data: parent } = await req.db!
        .from('post_comments')
        .select('id, post_id, parent_id, user_id')
        .eq('id', parentId)
        .eq('school_id', schoolId)
        .maybeSingle();
      if (!parent || parent.post_id !== postId) {
        res.status(400).json({ error: 'Invalid parent comment' });
        return;
      }
      // Flatten: replies to replies attach to the same top-level parent
      resolvedParentId = parent.parent_id ?? parent.id;
      directParentUserId = parent.user_id;
    }

    const { data, error } = await req.db!
      .from('post_comments')
      .insert({
        school_id: schoolId,
        post_id: postId,
        user_id: userId,
        parent_id: resolvedParentId,
        body: body.trim(),
      })
      .select('id, post_id, user_id, parent_id, body, created_at, users(first_name, last_name, role, profile_picture)')
      .single();

    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

    // Notify the post author + (if reply) the user being replied to.
    // Skip self-notification and de-duplicate when the same user is both targets.
    const { data: post } = await req.db!
      .from('academic_posts')
      .select('title, author_user_id')
      .eq('id', postId)
      .eq('school_id', schoolId)
      .maybeSingle();
    const { data: commenter } = await req.db!
      .from('users')
      .select('first_name, last_name')
      .eq('id', userId)
      .maybeSingle();
    const commenterName = `${commenter?.first_name ?? ''} ${commenter?.last_name ?? ''}`.trim() || 'Someone';
    const postTitle = (post?.title as string | undefined) ?? 'your post';
    const preview = body.trim().length > 80 ? body.trim().substring(0, 80) + '…' : body.trim();
    const targets = new Set<string>();
    if (post?.author_user_id && post.author_user_id !== userId) targets.add(post.author_user_id);
    if (directParentUserId && directParentUserId !== userId && directParentUserId !== post?.author_user_id) targets.add(directParentUserId);
    if (targets.size > 0) {
      const payloads = Array.from(targets).map(uid => ({
        schoolId,
        userId: uid,
        title: directParentUserId === uid
          ? `${commenterName} replied to your comment`
          : `${commenterName} commented on "${postTitle}"`,
        message: preview,
        type: 'post',
        relatedId: String(postId),
      }));
      notifyMany(payloads).catch(() => {});
    }

    let authorSubject: string | null = null;
    if ((data as any)?.users?.role === 'teacher') {
      const { data: teacher } = await req.db!
        .from('teachers')
        .select('subject')
        .eq('user_id', userId)
        .maybeSingle();
      authorSubject = (teacher as any)?.subject ?? null;
    }

    res.status(201).json({ ...data, author_subject: authorSubject, likes_count: 0, liked_by_me: false });
  } catch {
    res.status(500).json({ error: 'Failed to create comment' });
  }
}

export async function toggleCommentLike(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { commentId } = req.params;

  try {
    const { data: existing } = await req.db!
      .from('post_comment_likes')
      .select('id')
      .eq('comment_id', commentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await req.db!.from('post_comment_likes').delete().eq('id', existing.id);
      const { count } = await req.db!.from('post_comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
      res.json({ liked: false, likesCount: count ?? 0 });
      return;
    }

    const { error } = await req.db!
      .from('post_comment_likes')
      .insert({ school_id: schoolId, comment_id: commentId, user_id: userId });
    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

    const { count } = await req.db!.from('post_comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
    res.json({ liked: true, likesCount: count ?? 0 });
  } catch {
    res.status(500).json({ error: 'Failed to toggle comment like' });
  }
}

export async function deleteComment(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { commentId } = req.params;

  try {
    const { data: existing } = await req.db!
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

    const { error } = await req.db!
      .from('post_comments')
      .update({ is_deleted: true })
      .eq('id', commentId);

    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
}

// ── E-BOOKS ───────────────────────────────────────────────────────────────────

export async function getEbooks(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;

  try {
    let query = req.db!
      .from('ebooks')
      .select('*, classes(name)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (role === 'parent') {
      const classIds = await getParentClassIds(req.db!, userId);
      if (classIds.length > 0) {
        query = query.or(`class_id.in.(${classIds.join(',')}),class_id.is.null`);
      } else {
        query = query.is('class_id', null);
      }
    }

    const { data, error } = await query;
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
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
    const ext = safeExt(file.originalname, '.bin');
    const path = `ebooks/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';

    const { error: uploadErr } = await req.db!.storage
      .from(bucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

    if (uploadErr) { res.status(safeDbErrorStatus(uploadErr)).json({ error: safeDbErrorMessage(uploadErr) }); return; }

    const { data: { publicUrl } } = req.db!.storage.from(bucket).getPublicUrl(path);

    const { data, error } = await req.db!
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

    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: 'Failed to upload e-book' });
  }
}

export async function deleteEbook(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const { error } = await req.db!.from('ebooks').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

// ── EBOOK PROGRESS ────────────────────────────────────────────────────────────

export async function getEbookProgress(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { ebookId, studentId } = req.query as { ebookId?: string; studentId?: string };

  try {
    let query = req.db!
      .from('ebook_progress')
      .select('id, ebook_id, student_id, current_page, total_pages, percent, updated_at, students(full_name)')
      .eq('school_id', schoolId);

    if (ebookId) query = query.eq('ebook_id', ebookId);

    if (role === 'parent') {
      const { data: parent } = await req.db!.from('parents').select('id').eq('user_id', userId).single();
      if (!parent) { res.json([]); return; }
      const { data: students } = await req.db!.from('students').select('id').eq('parent_id', parent.id);
      const ids = (students ?? []).map((s: any) => s.id);
      if (ids.length === 0) { res.json([]); return; }
      query = query.in('student_id', ids);
    }

    if (studentId) query = query.eq('student_id', studentId);

    const { data, error } = await query;
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
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
      const { data: parent } = await req.db!.from('parents').select('id').eq('user_id', userId).single();
      if (!parent) { res.status(403).json({ error: 'Forbidden' }); return; }
      const { data: student } = await req.db!.from('students').select('id').eq('id', studentId).eq('parent_id', parent.id).maybeSingle();
      if (!student) { res.status(403).json({ error: 'Forbidden' }); return; }
    }

    const percent = totalPages && totalPages > 0
      ? Math.min(100, Math.max(0, Math.round((currentPage / totalPages) * 10000) / 100))
      : 0;

    const { data, error } = await req.db!
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

    if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to save progress' });
  }
}
