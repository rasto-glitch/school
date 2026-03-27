import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { GraduationCap, Eye, EyeOff, LogIn, ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';

export const SCHOOL_STORAGE_KEY = 'selected-school';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean(),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth, isAuthenticated, user } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  // School from navigation state (just picked) or localStorage (returning user)
  const stateSchool = (location.state as any)?.school ?? null;
  const storedSchool = (() => {
    try { return JSON.parse(localStorage.getItem(SCHOOL_STORAGE_KEY) || 'null'); }
    catch { return null; }
  })();
  const school = stateSchool ?? storedSchool;

  const ROLE_DASHBOARDS: Record<string, string> = {
    parent: '/parent/dashboard',
    teacher: '/teacher/dashboard',
    admin: '/admin/dashboard',
    driver: '/driver/dashboard',
    supervisor: '/supervisor/dashboard',
  };

  // Already logged in → skip login page
  useEffect(() => {
    if (isAuthenticated() && user) {
      navigate(ROLE_DASHBOARDS[user.role] || '/admin/dashboard', { replace: true });
      return;
    }
    if (!school) navigate('/select-school', { replace: true });
  }, []);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { rememberMe: false },
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const res = await authApi.login(data.username, data.password, school.slug);
      const { token, user } = res.data;

      // Persist the school only after a successful login
      localStorage.setItem(SCHOOL_STORAGE_KEY, JSON.stringify(school));

      setAuth(token, user, school, data.rememberMe);

      const redirects: Record<string, string> = {
        parent: '/parent/dashboard',
        teacher: '/teacher/dashboard',
        admin: '/admin/dashboard',
        driver: '/driver/dashboard',
        supervisor: '/supervisor/dashboard',
      };
      navigate(redirects[user.role] || '/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  if (!school) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-secondary-600 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4">
            <GraduationCap className="w-9 h-9 text-primary-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">School Portal</h1>
          <p className="text-primary-200 mt-1">Sign in to your account</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* School indicator with back button */}
          <div className="flex items-center justify-between mb-6 pb-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                {school.logoUrl ? (
                  <img src={school.logoUrl} alt="" className="w-9 h-9 rounded-xl object-cover" />
                ) : (
                  <GraduationCap className="w-4 h-4 text-primary-600" />
                )}
              </div>
              <span className="text-sm font-semibold text-gray-800">{school.name}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/select-school')}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Change
            </button>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Username"
              placeholder="Enter your username"
              error={errors.username?.message}
              autoComplete="username"
              {...register('username')}
            />
            <div className="relative">
              <Input
                label="Password"
                type={showPass ? 'text' : 'password'}
                placeholder="Enter your password"
                error={errors.password?.message}
                autoComplete="current-password"
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Remember Me */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                {...register('rememberMe')}
              />
              <span className="text-sm text-gray-600">Remember me</span>
            </label>

            <Button
              type="submit"
              fullWidth
              loading={loading}
              icon={<LogIn className="w-4 h-4" />}
              className="mt-2"
            >
              Sign In
            </Button>

            <div className="text-center mt-3">
              <button
                type="button"
                onClick={() => navigate('/forgot-password', { state: { school } })}
                className="text-sm text-primary-600 hover:text-primary-800 font-medium transition-colors"
              >
                Forgot password?
              </button>
            </div>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            Contact your school administrator if you need login credentials.
          </p>
        </div>
      </div>
    </div>
  );
}
