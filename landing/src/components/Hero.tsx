import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowRight, ShieldCheck, Radio, Globe2 } from 'lucide-react';

export default function Hero() {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden">
      {/* Blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -start-20 h-[420px] w-[420px] rounded-full bg-primary-200/50 blur-3xl animate-blob" />
        <div className="absolute top-20 -end-10 h-[380px] w-[380px] rounded-full bg-indigo-100 blur-3xl animate-blob [animation-delay:2s]" />
      </div>

      <div className="mx-auto max-w-content container-px pt-20 pb-24 md:pt-28 md:pb-32 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-white/70 px-4 py-1.5 text-xs font-semibold text-primary-700 mb-6 backdrop-blur"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-500 animate-pulse" />
          {t('hero.eyebrow')}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.1]"
        >
          {t('hero.title')}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mt-6 mx-auto max-w-2xl text-base sm:text-lg text-slate-600"
        >
          {t('hero.subtitle')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <Link
            to="/demo"
            className="group inline-flex items-center gap-2 rounded-full bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-600/20 hover:bg-primary-700 transition"
          >
            {t('hero.ctaPrimary')}
            <ArrowRight size={16} className="transition group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
          </Link>
          <Link
            to="/partner"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-800 hover:border-primary-200 hover:text-primary-700 transition"
          >
            {t('hero.ctaSecondary')}
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto"
        >
          {[
            { icon: ShieldCheck, title: t('hero.stats.tenants'), desc: t('hero.stats.tenantsDesc') },
            { icon: Radio, title: t('hero.stats.realtime'), desc: t('hero.stats.realtimeDesc') },
            { icon: Globe2, title: t('hero.stats.languages'), desc: t('hero.stats.languagesDesc') },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-4 text-start">
              <div className="flex items-center gap-2 text-primary-600">
                <Icon size={16} />
                <span className="text-sm font-bold text-slate-900">{title}</span>
              </div>
              <div className="mt-1 text-xs text-slate-600">{desc}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
