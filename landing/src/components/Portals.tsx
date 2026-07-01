import { useTranslation } from 'react-i18next';
import { Users, Presentation, Eye, Truck, ShieldCheck, Calculator, Building2, Clock } from 'lucide-react';
import { Reveal, SectionHeader } from './Section';

export default function Portals() {
  const { t } = useTranslation();

  const roles = [
    { key: 'parent',     icon: Users },
    { key: 'teacher',    icon: Presentation },
    { key: 'supervisor', icon: Eye },
    { key: 'driver',     icon: Truck },
    { key: 'admin',      icon: ShieldCheck },
    { key: 'accountant', icon: Calculator },
    { key: 'reception',  icon: Building2 },
    { key: 'staff',      icon: Clock },
  ];

  return (
    <section id="portals" className="py-20 md:py-28 bg-slate-50 border-y border-slate-200 dark:bg-slate-900/40 dark:border-slate-800">
      <div className="mx-auto max-w-content container-px">
        <SectionHeader
          eyebrow={t('portals.eyebrow')}
          title={t('portals.title')}
          subtitle={t('portals.subtitle')}
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {roles.map(({ key, icon: Icon }, i) => (
            <Reveal key={key} delay={i * 0.04}>
              <div className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-primary-300 hover:-translate-y-0.5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/40">
                <div className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
                  <Icon size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {t(`portals.items.${key}.title`)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600 leading-relaxed dark:text-slate-400">
                    {t(`portals.items.${key}.desc`)}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
