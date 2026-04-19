import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Globe2, Coins, Handshake } from 'lucide-react';
import { Reveal } from '../components/Section';

type Status = 'idle' | 'sending' | 'success' | 'error';

export default function PartnerPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setTimeout(() => setStatus('success'), 800);
  };

  const input = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-400 focus:ring-4 focus:ring-primary-100 outline-none transition';
  const label = 'block text-sm font-semibold text-slate-800 mb-1.5';

  const reasons = [
    { key: 'whitelabel', icon: Globe2 },
    { key: 'revenue',    icon: Coins },
    { key: 'support',    icon: Handshake },
  ];

  if (status === 'success') {
    return (
      <section className="py-24 md:py-32">
        <div className="mx-auto max-w-xl container-px text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-6">
            <CheckCircle2 size={36} />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900">
            {t('partner.form.success')}
          </h1>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-content container-px text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900">
            {t('partner.title')}
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-slate-600">{t('partner.subtitle')}</p>
        </div>
      </section>

      <section className="pb-10">
        <div className="mx-auto max-w-content container-px">
          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 text-center mb-10">
            {t('partner.whyTitle')}
          </h2>
          <div className="grid gap-5 md:grid-cols-3">
            {reasons.map(({ key, icon: Icon }, i) => (
              <Reveal key={key} delay={i * 0.05}>
                <div className="h-full rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600 mb-4">
                    <Icon size={22} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">
                    {t(`partner.why.${key}.title`)}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {t(`partner.why.${key}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-2xl container-px">
          <form
            onSubmit={onSubmit}
            className="rounded-3xl border border-slate-200 bg-white shadow-sm p-6 sm:p-10 space-y-5"
          >
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label className={label}>{t('partner.form.companyName')}</label>
                <input required className={input} />
              </div>
              <div>
                <label className={label}>{t('partner.form.contactName')}</label>
                <input required className={input} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label className={label}>{t('partner.form.email')}</label>
                <input required type="email" className={input} />
              </div>
              <div>
                <label className={label}>{t('partner.form.phone')}</label>
                <input type="tel" className={input} />
              </div>
            </div>

            <div>
              <label className={label}>{t('partner.form.country')}</label>
              <input className={input} />
            </div>

            <div>
              <label className={label}>{t('partner.form.about')}</label>
              <textarea rows={5} className={input} />
            </div>

            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full rounded-full bg-primary-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-primary-600/20 hover:bg-primary-700 disabled:opacity-60 transition"
            >
              {status === 'sending' ? t('partner.form.sending') : t('partner.form.submit')}
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
