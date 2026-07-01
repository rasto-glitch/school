import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './Section';

export default function CTA() {
  const { t } = useTranslation();

  return (
    <section className="py-20 md:py-24">
      <div className="mx-auto max-w-content container-px">
        <Reveal>
          <div className="rounded-3xl bg-slate-900 px-6 py-14 text-center sm:px-12 md:py-20 dark:ring-1 dark:ring-slate-800">
            <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              {t('cta.title')}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-slate-300">
              {t('cta.subtitle')}
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                to="/demo"
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
              >
                {t('cta.primary')}
                <ArrowRight size={16} className="transition group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
              </Link>
              <Link
                to="/partner"
                className="inline-flex items-center justify-center rounded-lg border border-white/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {t('cta.secondary')}
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
