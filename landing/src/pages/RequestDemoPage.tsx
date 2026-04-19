import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { postPublic } from '../lib/api';

type Status = 'idle' | 'sending' | 'success' | 'error';

export default function RequestDemoPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async (fd: FormData) => {
    const body = {
      schoolName:  String(fd.get('schoolName') || ''),
      contactName: String(fd.get('contactName') || ''),
      role:        String(fd.get('role') || ''),
      students:    String(fd.get('students') || ''),
      email:       String(fd.get('email') || ''),
      phone:       String(fd.get('phone') || ''),
      message:     String(fd.get('message') || ''),
      website:     String(fd.get('website') || ''), // honeypot
    };
    setStatus('sending');
    setErrorMsg('');
    try {
      await postPublic('demo-request', body);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('demo.form.error'));
      setStatus('error');
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
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900">
            {t('demo.form.success')}
          </h1>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-2xl container-px">
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900">
            {t('demo.title')}
          </h1>
          <p className="mt-3 text-slate-600">{t('demo.subtitle')}</p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}
          className="rounded-3xl border border-slate-200 bg-white shadow-sm p-6 sm:p-10 space-y-5"
        >
          {/* Honeypot — hidden from real users */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 }}
          />

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className={label}>{t('demo.form.schoolName')}</label>
              <input name="schoolName" required className={input} />
            </div>
            <div>
              <label className={label}>{t('demo.form.contactName')}</label>
              <input name="contactName" required className={input} />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className={label}>{t('demo.form.role')}</label>
              <input name="role" placeholder={t('demo.form.rolePlaceholder')} className={input} />
            </div>
            <div>
              <label className={label}>{t('demo.form.students')}</label>
              <input name="students" type="number" className={input} />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className={label}>{t('demo.form.email')}</label>
              <input name="email" required type="email" className={input} />
            </div>
            <div>
              <label className={label}>{t('demo.form.phone')}</label>
              <input name="phone" type="tel" className={input} />
            </div>
          </div>

          <div>
            <label className={label}>{t('demo.form.message')}</label>
            <textarea name="message" rows={4} className={input} />
          </div>

          {status === 'error' && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg || t('demo.form.error')}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full rounded-full bg-primary-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-primary-600/20 hover:bg-primary-700 disabled:opacity-60 transition"
          >
            {status === 'sending' ? t('demo.form.sending') : t('demo.form.submit')}
          </button>
        </form>
      </div>
    </section>
  );
}
