import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import BrowserFrame from './mockups/BrowserFrame';
import WebDashboardMock from './mockups/WebDashboardMock';
import PhoneFrame from './mockups/PhoneFrame';
import parentShot from '../../assets/parent-dashboard-mobile.png';

const FACTS = ['portals', 'bus', 'langs', 'platforms'] as const;

export default function Hero() {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden">
      {/* quiet wash — no blobs */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-primary-50/70 via-white to-white dark:from-primary-900/20 dark:via-slate-950 dark:to-slate-950" />

      <div className="mx-auto grid max-w-content container-px items-center gap-12 pt-16 pb-20 md:pt-20 lg:grid-cols-12 lg:gap-8">
        {/* copy */}
        <div className="lg:col-span-5">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-xs font-bold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400"
          >
            {t('hero.eyebrow')}
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl dark:text-white"
          >
            {t('hero.title')}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-400"
          >
            {t('hero.subtitle')}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <Link
              to="/demo"
              className="group inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
            >
              {t('hero.ctaPrimary')}
              <ArrowRight size={16} className="transition group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
            </Link>
            <a
              href="#flagship"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600"
            >
              {t('hero.ctaSecondary')}
            </a>
          </motion.div>

          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-600 dark:text-slate-400"
          >
            {FACTS.map((k) => (
              <li key={k} className="flex items-center gap-2">
                <Check size={15} className="shrink-0 text-primary-600 dark:text-primary-400" />
                {t(`hero.facts.${k}`)}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* product shot */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
          className="relative lg:col-span-7"
        >
          <BrowserFrame url="app.scholify.krd/admin" className="lg:ms-6">
            <WebDashboardMock />
          </BrowserFrame>

          {/* phone peeking — the same product on mobile */}
          <div className="pointer-events-none absolute -bottom-20 -start-10 hidden w-48 lg:block xl:w-52">
            <PhoneFrame src={parentShot} alt="Scholify parent app — home feed" />
          </div>

          <div className="mt-4 text-center text-xs text-slate-400 lg:text-end lg:pe-2 dark:text-slate-500">
            {t('hero.shot.caption')}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
