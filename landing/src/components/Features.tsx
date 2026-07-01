import { useTranslation } from 'react-i18next';
import {
  MessagesSquare, BookOpen, Library, HeartPulse, Briefcase, ShieldCheck,
  Wallet, KeyRound,
} from 'lucide-react';
import { Reveal, SectionHeader } from './Section';

export default function Features() {
  const { t } = useTranslation();

  const items = [
    { key: 'chat',      icon: MessagesSquare, accent: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' },
    { key: 'homework',  icon: BookOpen,       accent: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' },
    { key: 'academic',  icon: Library,        accent: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400' },
    { key: 'health',    icon: HeartPulse,     accent: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' },
    { key: 'hr',        icon: Briefcase,      accent: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
    { key: 'clearance', icon: ShieldCheck,    accent: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' },
    { key: 'fees',      icon: Wallet,         accent: 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400' },
    { key: 'login',     icon: KeyRound,       accent: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  ];

  return (
    <section id="features" className="py-20 md:py-28">
      <div className="mx-auto max-w-content container-px">
        <SectionHeader
          eyebrow={t('features.eyebrow')}
          title={t('features.title')}
          subtitle={t('features.subtitle')}
        />

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ key, icon: Icon, accent }, i) => (
            <Reveal key={key} delay={i * 0.05}>
              <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-primary-200 hover:shadow-xl hover:shadow-primary-600/5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/40">
                <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${accent} mb-4 transition group-hover:scale-105`}>
                  <Icon size={22} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2 dark:text-white">
                  {t(`features.items.${key}.title`)}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed dark:text-slate-400">
                  {t(`features.items.${key}.desc`)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
