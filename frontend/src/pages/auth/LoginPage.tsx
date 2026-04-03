import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  GraduationCap, Eye, EyeOff, LogIn, BookOpen, Users, BarChart3,
  Shield, ChevronRight, Sparkles,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean(),
});

type FormData = z.infer<typeof schema>;

const ROLE_DASHBOARDS: Record<string, string> = {
  parent: '/parent/dashboard',
  teacher: '/teacher/dashboard',
  admin: '/admin/dashboard',
  driver: '/driver/dashboard',
  supervisor: '/supervisor/dashboard',
  reception: '/reception/dashboard',
};

const FEATURES = [
  { icon: BookOpen, title: 'Smart Curriculum', desc: 'Homework, assignments & grades at your fingertips' },
  { icon: Users, title: 'Connected Community', desc: 'Real-time communication between parents & teachers' },
  { icon: BarChart3, title: 'Progress Tracking', desc: 'Detailed reports and academic analytics' },
  { icon: Shield, title: 'Safe & Secure', desc: 'Enterprise-grade security for student data' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth, isAuthenticated, user } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated() && user) {
      navigate(ROLE_DASHBOARDS[user.role] || '/admin/dashboard', { replace: true });
    }
  }, []);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { rememberMe: false },
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const res = await authApi.login(data.username, data.password);
      const { token, user, school } = res.data;
      setAuth(token, user, school, data.rememberMe);
      navigate(ROLE_DASHBOARDS[user.role] || '/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* ─── Left Panel: Hero ─── */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary-700 via-primary-600 to-secondary-600" />

        {/* Decorative pattern */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Floating decorative circles */}
        <div className="absolute top-20 left-20 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-secondary-400/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/3 w-48 h-48 bg-primary-300/15 rounded-full blur-2xl" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          {/* Top: Logo & branding */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-11 h-11 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center border border-white/20">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-white font-bold text-xl tracking-tight">Academic Portal</h2>
                <p className="text-white/60 text-xs font-medium">School Management System</p>
              </div>
            </div>
          </div>

          {/* Center: Hero text */}
          <div className="max-w-lg">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 mb-6">
              <Sparkles className="w-3.5 h-3.5 text-secondary-300" />
              <span className="text-xs font-semibold text-white/90">Empowering Education</span>
            </div>
            <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-tight mb-4">
              Where learning
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-secondary-300 to-secondary-100">
                meets innovation
              </span>
            </h1>
            <p className="text-lg text-white/70 leading-relaxed mb-10">
              A unified platform connecting students, parents, teachers and administrators for a seamless academic experience.
            </p>

            {/* Feature cards */}
            <div className="grid grid-cols-2 gap-3">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl p-4 hover:bg-white/15 transition-colors group">
                  <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Icon className="w-4.5 h-4.5 text-secondary-300" />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
                  <p className="text-xs text-white/50 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom: Stats */}
          <div className="flex items-center gap-8 pt-4">
            <div>
              <div className="text-2xl font-extrabold text-white">10k+</div>
              <div className="text-xs text-white/50 font-medium">Students</div>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div>
              <div className="text-2xl font-extrabold text-white">500+</div>
              <div className="text-xs text-white/50 font-medium">Teachers</div>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div>
              <div className="text-2xl font-extrabold text-white">50+</div>
              <div className="text-xs text-white/50 font-medium">Schools</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Right Panel: Login Form ─── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-[420px]">
          {/* Mobile-only logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-600 rounded-2xl shadow-lg shadow-primary-200 mb-4">
              <GraduationCap className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Academic Portal</h1>
            <p className="text-sm text-gray-500 mt-1">School Management System</p>
          </div>

          {/* Form header */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-500 mt-1.5">Sign in to access your portal</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Username */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Username</label>
              <input
                type="text"
                placeholder="e.g. school_username"
                autoComplete="username"
                className={`w-full bg-white border ${errors.username ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100'} rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition-all`}
                {...register('username')}
              />
              {errors.username && <p className="text-xs text-red-500 mt-1.5">{errors.username.message}</p>}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className={`w-full bg-white border ${errors.password ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100'} rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 placeholder-gray-400 outline-none transition-all`}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1.5">{errors.password.message}</p>}
            </div>

            {/* Remember me + Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                  {...register('rememberMe')}
                />
                <span className="text-sm text-gray-600 group-hover:text-gray-800 transition-colors">Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="text-sm text-primary-600 hover:text-primary-800 font-semibold transition-colors"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-primary-200 hover:shadow-xl hover:shadow-primary-200 active:scale-[0.98] group"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign In
                  <ChevronRight className="w-4 h-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-xs text-gray-400 mt-8">
            Contact your school administrator for login credentials
          </p>

          {/* Bottom branding for desktop */}
          <div className="hidden lg:flex items-center justify-center gap-1.5 mt-12 text-xs text-gray-300">
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Academic Portal</span>
            <span className="text-gray-200">·</span>
            <span>School Management System</span>
          </div>
        </div>
      </div>
    </div>
  );
}
