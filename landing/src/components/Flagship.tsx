import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CalendarDays, Bus, GraduationCap, ClipboardCheck } from 'lucide-react';
import { Reveal, SectionHeader } from './Section';
import BrowserFrame from './mockups/BrowserFrame';
import PhoneFrame from './mockups/PhoneFrame';
import ScheduleGridMock from './mockups/ScheduleGridMock';
import ReportCardMock from './mockups/ReportCardMock';
import PhoneClockInMock from './mockups/PhoneClockInMock';
import busShot from '../../assets/bus-tracking.png';

type Item = {
  key: string;
  icon: typeof CalendarDays;
  visual: ReactNode;
};

const ITEMS: Item[] = [
  {
    key: 'schedule',
    icon: CalendarDays,
    visual: (
      <BrowserFrame url="app.scholify.krd/admin/schedule">
        <ScheduleGridMock />
      </BrowserFrame>
    ),
  },
  {
    key: 'bus',
    icon: Bus,
    visual: (
      <div className="mx-auto w-full max-w-[280px]">
        <PhoneFrame src={busShot} alt="Live bus tracking on the Scholify app" />
      </div>
    ),
  },
  {
    key: 'grades',
    icon: GraduationCap,
    visual: (
      <BrowserFrame url="app.scholify.krd/admin/report-cards">
        <div className="bg-slate-100 p-6">
          <ReportCardMock />
        </div>
      </BrowserFrame>
    ),
  },
  {
    key: 'attendance',
    icon: ClipboardCheck,
    visual: (
      <div className="mx-auto w-full max-w-[280px]">
        <PhoneFrame>
          <PhoneClockInMock />
        </PhoneFrame>
      </div>
    ),
  },
];

const POINTS = ['a', 'b', 'c'] as const;

export default function Flagship() {
  const { t } = useTranslation();

  return (
    <section id="flagship" className="py-20 md:py-28">
      <div className="mx-auto max-w-content container-px">
        <SectionHeader
          eyebrow={t('flagship.eyebrow')}
          title={t('flagship.title')}
          subtitle={t('flagship.subtitle')}
        />

        <div className="flex flex-col gap-20 md:gap-28">
          {ITEMS.map(({ key, icon: Icon, visual }, i) => {
            const flip = i % 2 === 1;
            return (
              <Reveal key={key}>
                <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                  {/* copy */}
                  <div className={flip ? 'lg:order-2' : ''}>
                    <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                      <Icon size={14} />
                      {t(`flagship.items.${key}.tag`)}
                    </div>
                    <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
                      {t(`flagship.items.${key}.title`)}
                    </h3>
                    <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-400">
                      {t(`flagship.items.${key}.desc`)}
                    </p>
                    <ul className="mt-6 flex flex-col gap-3">
                      {POINTS.map((p) => (
                        <li key={p} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300">
                            <Check size={12} strokeWidth={3} />
                          </span>
                          {t(`flagship.items.${key}.points.${p}`)}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* visual */}
                  <div className={flip ? 'lg:order-1' : ''}>{visual}</div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
