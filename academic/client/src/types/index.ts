export type Role = 'parent' | 'teacher' | 'admin' | 'supervisor';

export interface School {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  firstName: string;
  lastName: string;
}

export interface AcademicClass {
  id: string;
  name: string;
  gradeLevel?: string;
}

export interface AcademicPost {
  id: string;
  title: string;
  subject?: string;
  body?: string;
  content?: string;
  content_type: 'richtext' | 'plaintext' | 'file';
  attachment_url?: string;
  attachment_name?: string;
  image_url?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  class_id?: string | null;
  teacher_id?: string | null;
  author_user_id?: string | null;
  author_role?: 'teacher' | 'supervisor';
  author_name?: string;
  author_subject?: string | null;
  author_avatar?: string | null;
  likes_count?: number;
  saves_count?: number;
  comments_count?: number;
  liked_by_me?: boolean;
  saved_by_me?: boolean;
  classes?: { name: string } | null;
  teachers?: { full_name: string; subject?: string; user_id?: string } | null;
}

export interface PostComment {
  id: string;
  post_id: string;
  user_id: string;
  parent_id?: string | null;
  body: string;
  created_at: string;
  likes_count?: number;
  liked_by_me?: boolean;
  author_subject?: string | null;
  users?: { first_name: string; last_name: string; role: string; profile_picture?: string };
}

export interface Ebook {
  id: string;
  title: string;
  subject?: string;
  author?: string;
  cover_url?: string;
  file_url: string;
  description?: string;
  class_id?: string;
  created_at: string;
  classes?: { name: string };
}
