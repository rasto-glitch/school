import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Mail, Loader } from 'lucide-react';
import { postAuth } from '../lib/api';

type Status = 'pending' | 'success' | 'error';

export default function ConfirmEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [status, setStatus] = useState<Status>('pending');
  const [confirmedEmail, setConfirmedEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    // React StrictMode mounts effects twice in dev; using a ref guards the
    // single-use token from being burned by the second mount.
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setStatus('error');
      setErrorMsg(t('confirm.no_token'));
      return;
    }

    (async () => {
      try {
        const data = await postAuth<{ token: string }, { email: string }>('confirm-email', { token });
        setConfirmedEmail(data.email);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : t('confirm.generic_error'));
      }
    })();
  }, [token, t]);

  return (
    <section className="py-24 md:py-32">
      <div className="mx-auto max-w-xl container-px text-center">
        {status === 'pending' && (
          <>
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-primary-600 mb-6 animate-pulse">
              <Loader size={32} className="animate-spin" />
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900">{t('confirm.pending_title')}</h1>
            <p className="mt-3 text-slate-600">{t('confirm.pending_body')}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-6">
              <CheckCircle2 size={36} />
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900">{t('confirm.success_title')}</h1>
            <p className="mt-3 text-slate-600">{t('confirm.success_body')}</p>
            <p className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary-700">
              <Mail size={16} />
              {confirmedEmail}
            </p>
            <div className="mt-8">
              <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
                {t('confirm.back_home')}
              </Link>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-600 mb-6">
              <AlertCircle size={36} />
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900">{t('confirm.error_title')}</h1>
            <p className="mt-3 text-slate-600">{errorMsg || t('confirm.error_body')}</p>
            <div className="mt-8">
              <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
                {t('confirm.back_home')}
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
