import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password, portal: 'academic' }),
};

export const academicApi = {
  // Posts
  getPosts: (classId?: string) =>
    api.get('/academic/posts', { params: classId ? { classId } : {} }),
  getPost: (id: string) => api.get(`/academic/posts/${id}`),
  createPost: (data: {
    title: string; subject?: string; classId?: string;
    content?: string; body?: string; contentType: string; isPublished: boolean;
    imageUrl?: string;
  }) => api.post('/academic/posts', data),
  updatePost: (id: string, data: Partial<{
    title: string; subject: string; classId: string;
    content: string; body: string; contentType: string; isPublished: boolean;
    imageUrl: string;
  }>) => api.put(`/academic/posts/${id}`, data),
  deletePost: (id: string) => api.delete(`/academic/posts/${id}`),
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/academic/posts/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getClasses: () => api.get('/academic/classes'),

  // Social
  toggleLike: (postId: string) => api.post(`/academic/posts/${postId}/like`),
  toggleSave: (postId: string) => api.post(`/academic/posts/${postId}/save`),
  getSavedPosts: () => api.get('/academic/saved'),
  getComments: (postId: string) => api.get(`/academic/posts/${postId}/comments`),
  createComment: (postId: string, body: string) => api.post(`/academic/posts/${postId}/comments`, { body }),
  deleteComment: (commentId: string) => api.delete(`/academic/comments/${commentId}`),

  // Ebook progress
  getEbookProgress: (params?: { ebookId?: string; studentId?: string }) =>
    api.get('/academic/ebook-progress', { params }),
  upsertEbookProgress: (data: { ebookId: string; studentId: string; currentPage: number; totalPages?: number }) =>
    api.post('/academic/ebook-progress', data),

  // E-books
  getEbooks: () => api.get('/academic/ebooks'),
  uploadEbook: (data: { title: string; subject?: string; author?: string; description?: string; classId?: string; file: File }) => {
    const form = new FormData();
    form.append('file', data.file);
    form.append('title', data.title);
    if (data.subject) form.append('subject', data.subject);
    if (data.author) form.append('author', data.author);
    if (data.description) form.append('description', data.description);
    if (data.classId) form.append('classId', data.classId);
    return api.post('/academic/ebooks', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  deleteEbook: (id: string) => api.delete(`/academic/ebooks/${id}`),
};

export default api;
