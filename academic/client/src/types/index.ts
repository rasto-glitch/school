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
  content?: string;
  content_type: 'richtext' | 'plaintext' | 'file';
  attachment_url?: string;
  attachment_name?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  class_id: string;
  teacher_id: string;
  classes?: { name: string };
  teachers?: { full_name: string; user_id?: string };
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
