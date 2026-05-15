import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { postAuth } from '../lib/api';

type Status = 'ready' | 'sending' | 'success' | 'error';

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  // Capture the token once, then scrub it from the URL so it doesn't sit in
  // browser history or leak via the Referer header to anything loaded later.
  const [token] = useState(() => params.get('token') || '');

  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>('ready');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (window.location.search.includes('token=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Reject pages opened without a token before the user even tries.
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMsg(t('reset.no_token'));
    }
  }, [token, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (pwd.length < 6) { setStatus('error'); setErrorMsg(t('reset.too_short')); return; }
    if (pwd !== confirm) { setStatus('error'); setErrorMsg(t('reset.no_match')); return; }
    setStatus('sending'); setErrorMsg('');
    try {
      await postAuth('reset-with-token', { token, newPassword: pwd });
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : t('reset.generic_error'));
    }
  };

  const input = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-400 focus:ring-4 focus:ring-primary-100 outline-none transition';
  const label = 'block text-sm font-semibold text-slate-800 mb-1.5';

  if (status === 'success') {
    return (
      <section className="py-24 md:py-32">
        <div className="mx-auto max-w-xl container-px text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-6">
            <CheckCircle2 size={36} />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900">{t('reset.success_title')}</h1>
          <p className="mt-3 text-slate-600">{t('reset.success_body')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-md container-px">
        <div className="text-center mb-10">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-600 mb-4">
            <Lock size={26} />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">
            {t('reset.title')}
          </h1>
          <p className="mt-3 text-slate-600">{t('reset.subtitle')}</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-3xl border border-slate-200 bg-white shadow-sm p-6 sm:p-8 space-y-4"
        >
          <div>
            <label className={label}>{t('reset.new_password')}</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={6}
              className={input}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              disabled={!token || status === 'sending'}
            />
          </div>
          <div>
            <label className={label}>{t('reset.confirm_password')}</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={6}
              className={input}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={!token || status === 'sending'}
            />
          </div>

          {status === 'error' && errorMsg && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!token || status === 'sending'}
            className="w-full rounded-full bg-primary-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-primary-600/20 hover:bg-primary-700 disabled:opacity-60 transition"
          >
            {status === 'sending' ? t('reset.submitting') : t('reset.submit')}
          </button>

          <div className="text-center pt-2">
            <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
              {t('reset.back_home')}
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
