import { useTranslation } from 'react-i18next';
import { Building2, Lock, KeyRound, ScrollText } from 'lucide-react';
import { Reveal, SectionHeader } from './Section';

const ITEMS = [
  { key: 'tenant', icon: Building2 },
  { key: 'encryption', icon: Lock },
  { key: 'mfa', icon: KeyRound },
  { key: 'audit', icon: ScrollText },
] as const;

export default function Security() {
  const { t } = useTranslation();

  return (
    <section id="security" className="border-y border-slate-200 bg-slate-50 py-20 md:py-28 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mx-auto max-w-content container-px">
        <SectionHeader
          eyebrow={t('security.eyebrow')}
          title={t('security.title')}
          subtitle={t('security.subtitle')}
        />

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map(({ key, icon: Icon }, i) => (
            <Reveal key={key} delay={i * 0.05}>
              <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-primary-600">
                  <Icon size={20} />
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                  {t(`security.items.${key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {t(`security.items.${key}.desc`)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
