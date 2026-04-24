import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Eye, EyeOff, LogIn, ChevronRight,
  Sparkles, BookOpen, FileText, Library, Shield,
} from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

const FEATURES = [
  { icon: BookOpen, title: 'Rich Content', desc: 'Articles, notes & explanations from teachers' },
  { icon: Library, title: 'E-Book Library', desc: 'Read textbooks directly in your browser' },
  { icon: FileText, title: 'Class-Filtered', desc: 'See only content relevant to your child' },
  { icon: Shield, title: 'Secure Access', desc: 'Same credentials as your school portal' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(username.trim(), password);
      const { token, user, school } = res.data;
      if (!['parent', 'teacher', 'admin', 'supervisor'].includes(user.role)) {
        setError('This portal is not available for your account type.');
        return;
      }
      setAuth(token, user, school);
      navigate('/feed');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* ─── Left Panel: Hero ─── */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary-700 via-primary-600 to-indigo-600" />

        {/* Grid pattern */}
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
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/3 w-48 h-48 bg-primary-300/15 rounded-full blur-2xl" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          {/* Top: Logo */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <img src="/logo.png" alt="Scholify" className="w-11 h-11 rounded-xl border border-white/20" />
              <div>
                <h2 className="text-white font-bold text-xl tracking-tight">Academic Portal</h2>
                <p className="text-white/60 text-xs font-medium">Knowledge Platform</p>
              </div>
            </div>
          </div>

          {/* Center: Hero text */}
          <div className="max-w-lg">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 mb-6">
              <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
              <span className="text-xs font-semibold text-white/90">Beyond the Classroom</span>
            </div>
            <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-tight mb-4">
              Where learning
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-indigo-100">
                never stops
              </span>
            </h1>
            <p className="text-lg text-white/70 leading-relaxed mb-10">
              Teachers share notes, explanations and resources. Parents and students explore, learn, and go deeper.
            </p>

            {/* Feature cards */}
            <div className="grid grid-cols-2 gap-3">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl p-4 hover:bg-white/15 transition-colors group">
                  <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Icon className="w-4.5 h-4.5 text-indigo-300" />
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
              <div className="text-2xl font-extrabold text-white">Rich Text</div>
              <div className="text-xs text-white/50 font-medium">Article Editor</div>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div>
              <div className="text-2xl font-extrabold text-white">PDF</div>
              <div className="text-xs text-white/50 font-medium">E-Book Reader</div>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div>
              <div className="text-2xl font-extrabold text-white">Per-Class</div>
              <div className="text-xs text-white/50 font-medium">Content Filter</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Right Panel: Login Form ─── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-[420px]">
          {/* Back link */}
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to home
          </Link>

          {/* Mobile-only logo */}
          <div className="lg:hidden text-center mb-8">
            <img src="/logo.png" alt="Scholify" className="inline-block w-14 h-14 rounded-2xl shadow-lg shadow-primary-200 mb-4" />
            <h1 className="text-2xl font-bold text-gray-900">Academic Portal</h1>
            <p className="text-sm text-gray-500 mt-1">Knowledge Platform</p>
          </div>

          {/* Form header */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-500 mt-1.5">Sign in to access academic content</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                autoFocus
                autoCapitalize="none"
                autoComplete="username"
                placeholder="e.g. school_username"
                className={`w-full bg-white border ${error ? 'border-gray-200' : 'border-gray-200'} focus:border-primary-500 focus:ring-2 focus:ring-primary-100 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition-all`}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="w-full bg-white border border-gray-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 placeholder-gray-400 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

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
            Use your school portal credentials to sign in
          </p>

          {/* Bottom branding for desktop */}
          <div className="hidden lg:flex items-center justify-center gap-1.5 mt-12 text-xs text-gray-300">
            <img src="/logo.png" alt="Scholify" className="w-3.5 h-3.5 rounded" />
            <span>Academic Portal</span>
            <span className="text-gray-200">·</span>
            <span>Knowledge Platform</span>
          </div>
        </div>
      </div>
    </div>
  );
}
