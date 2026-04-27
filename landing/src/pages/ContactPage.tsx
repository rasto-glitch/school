import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Mail } from 'lucide-react';
import { postPublic } from '../lib/api';

type Status = 'idle' | 'sending' | 'success' | 'error';

export default function ContactPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async (fd: FormData) => {
    const body = {
      name:    String(fd.get('name') || ''),
      email:   String(fd.get('email') || ''),
      subject: String(fd.get('subject') || ''),
      message: String(fd.get('message') || ''),
      website: String(fd.get('website') || ''), // honeypot
    };
    setStatus('sending');
    setErrorMsg('');
    try {
      await postPublic('contact-request', body);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('contact.form.error'));
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
            {t('contact.form.success')}
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
            {t('contact.title')}
          </h1>
          <p className="mt-3 text-slate-600">{t('contact.subtitle')}</p>
          <a
            href="mailto:contact@scholify.krd"
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            <Mail size={16} />
            contact@scholify.krd
          </a>
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
              <label className={label}>{t('contact.form.name')}</label>
              <input name="name" required className={input} />
            </div>
            <div>
              <label className={label}>{t('contact.form.email')}</label>
              <input name="email" required type="email" className={input} />
            </div>
          </div>

          <div>
            <label className={label}>{t('contact.form.subject')}</label>
            <input name="subject" className={input} />
          </div>

          <div>
            <label className={label}>{t('contact.form.message')}</label>
            <textarea name="message" required rows={6} className={input} />
          </div>

          {status === 'error' && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg || t('contact.form.error')}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full rounded-full bg-primary-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-primary-600/20 hover:bg-primary-700 disabled:opacity-60 transition"
          >
            {status === 'sending' ? t('contact.form.sending') : t('contact.form.submit')}
          </button>
        </form>
      </div>
    </section>
  );
}
