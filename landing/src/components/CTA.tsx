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
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 px-6 sm:px-12 py-14 md:py-20 text-center text-white">
            <div className="pointer-events-none absolute -top-20 -start-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -end-20 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
            <h2 className="relative text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight">
              {t('cta.title')}
            </h2>
            <p className="relative mt-4 max-w-xl mx-auto text-primary-100">
              {t('cta.subtitle')}
            </p>
            <div className="relative mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <Link
                to="/demo"
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-primary-700 hover:bg-primary-50 transition"
              >
                {t('cta.primary')}
                <ArrowRight size={16} className="transition group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
              </Link>
              <Link
                to="/partner"
                className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 transition"
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
