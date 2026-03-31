import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { GraduationCap, ArrowLeft, Send } from 'lucide-react';
import { authApi } from '../../services/api';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
});
type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      await authApi.forgotPassword(data.username);
    } finally {
      // Always show success to avoid username enumeration
      setSubmitted(true);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-secondary-600 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4">
            <GraduationCap className="w-9 h-9 text-primary-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">Reset Password</h1>
          <p className="text-primary-200 mt-1">Submit a request to your school administrator</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {submitted ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Send className="w-6 h-6 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800 mb-2">Request Submitted</h2>
              <p className="text-sm text-gray-500 mb-6">
                If this username exists, a reset request has been submitted to your school administrator.
                They will contact you with your new password.
              </p>
              <Button fullWidth variant="outline" onClick={() => navigate('/login')}>
                Back to Sign In
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-5">
                Enter your full username (e.g. fisk_username) and a reset request will be sent to your school administrator.
              </p>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Input
                  label="Username"
                  placeholder="e.g. fisk_username"
                  error={errors.username?.message}
                  autoComplete="username"
                  {...register('username')}
                />
                <Button
                  type="submit"
                  fullWidth
                  loading={loading}
                  icon={<Send className="w-4 h-4" />}
                >
                  Submit Request
                </Button>
              </form>
              <div className="text-center mt-4">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-800 font-medium transition-colors mx-auto"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Sign In
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
