import { useTranslation } from 'react-i18next';
import { Apple, Smartphone, Moon, Languages, BellRing } from 'lucide-react';
import { Reveal } from './Section';
import PhoneFrame from './mockups/PhoneFrame';
import PhoneClockInMock from './mockups/PhoneClockInMock';
import parentShot from '../../assets/parent-dashboard-mobile.png';

export default function MobileSection() {
  const { t } = useTranslation();

  const chips = [
    { icon: Moon, key: 'dark' },
    { icon: Languages, key: 'langs' },
    { icon: BellRing, key: 'offline' },
  ];

  return (
    <section id="mobile" className="overflow-hidden py-20 md:py-28">
      <div className="mx-auto grid max-w-content container-px items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-400">
              {t('mobile.eyebrow')}
            </div>
            <h2 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              {t('mobile.title')}
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-400">
              {t('mobile.subtitle')}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="https://apps.apple.com/us/app/scholify/id6764818420"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 rounded-xl bg-slate-900 px-5 py-3 text-white transition hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                <Apple size={24} />
                <span className="text-sm font-semibold">{t('mobile.appStore')}</span>
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.rastoelkurdi.schoolportal&pcampaignid=web_share"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 rounded-xl bg-slate-900 px-5 py-3 text-white transition hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                <Smartphone size={24} />
                <span className="text-sm font-semibold">{t('mobile.playStore')}</span>
              </a>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {chips.map(({ icon: Icon, key }) => (
                <div key={key} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <Icon size={14} className="text-primary-600 dark:text-primary-400" />
                  {t(`mobile.chips.${key}`)}
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="relative mx-auto flex max-w-lg items-end justify-center gap-4">
            <div className="w-44 sm:w-52">
              <div className="mb-2 text-center text-[11px] font-medium text-slate-400 dark:text-slate-500">{t('mobile.screens.home')}</div>
              <PhoneFrame src={parentShot} alt="Scholify parent app — home feed" className="animate-float" />

            </div>
            <div className="w-44 sm:w-52 translate-y-6">
              <div className="mb-2 text-center text-[11px] font-medium text-slate-400 dark:text-slate-500">{t('mobile.screens.clock')}</div>
              <PhoneFrame className="animate-float [animation-delay:1.5s]">
                <PhoneClockInMock />
              </PhoneFrame>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
