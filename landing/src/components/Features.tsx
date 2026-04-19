import { useTranslation } from 'react-i18next';
import {
  CalendarCheck, GraduationCap, Bus, MessagesSquare, BookOpen, Library,
} from 'lucide-react';
import { Reveal, SectionHeader } from './Section';

export default function Features() {
  const { t } = useTranslation();

  const items = [
    { key: 'attendance', icon: CalendarCheck, accent: 'bg-emerald-50 text-emerald-600' },
    { key: 'grades',     icon: GraduationCap, accent: 'bg-primary-50 text-primary-600' },
    { key: 'bus',        icon: Bus,           accent: 'bg-amber-50 text-amber-600' },
    { key: 'chat',       icon: MessagesSquare, accent: 'bg-sky-50 text-sky-600' },
    { key: 'homework',   icon: BookOpen,      accent: 'bg-rose-50 text-rose-600' },
    { key: 'academic',   icon: Library,       accent: 'bg-violet-50 text-violet-600' },
  ];

  return (
    <section id="features" className="py-20 md:py-28">
      <div className="mx-auto max-w-content container-px">
        <SectionHeader
          eyebrow={t('features.eyebrow')}
          title={t('features.title')}
          subtitle={t('features.subtitle')}
        />

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map(({ key, icon: Icon, accent }, i) => (
            <Reveal key={key} delay={i * 0.05}>
              <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-primary-200 hover:shadow-xl hover:shadow-primary-600/5">
                <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${accent} mb-4 transition group-hover:scale-105`}>
                  <Icon size={22} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">
                  {t(`features.items.${key}.title`)}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
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
