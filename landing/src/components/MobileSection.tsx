import { useTranslation } from 'react-i18next';
import { Apple, Smartphone, Moon, Languages } from 'lucide-react';
import { Reveal } from './Section';

export default function MobileSection() {
  const { t } = useTranslation();

  return (
    <section id="mobile" className="py-20 md:py-28 overflow-hidden">
      <div className="mx-auto max-w-content container-px grid gap-12 lg:grid-cols-2 items-center">
        <Reveal>
          <div>
            <div className="inline-block text-xs font-bold uppercase tracking-wider text-primary-600 bg-primary-50 rounded-full px-3 py-1 mb-4">
              {t('mobile.eyebrow')}
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
              {t('mobile.title')}
            </h2>
            <p className="mt-5 text-base sm:text-lg text-slate-600">
              {t('mobile.subtitle')}
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a
                href="https://apps.apple.com/us/app/scholify/id6764818420"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-3 rounded-2xl bg-slate-900 px-5 py-3 text-white hover:bg-slate-800 transition"
              >
                <Apple size={26} />
                <span className="text-sm font-semibold">{t('mobile.appStore')}</span>
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.rastoelkurdi.schoolportal&pcampaignid=web_share"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-3 rounded-2xl bg-slate-900 px-5 py-3 text-white hover:bg-slate-800 transition"
              >
                <Smartphone size={26} />
                <span className="text-sm font-semibold">{t('mobile.playStore')}</span>
              </a>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {[
                { icon: Moon, label: 'Dark mode' },
                { icon: Languages, label: 'EN · AR · KU · RTL' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                  <Icon size={14} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-8 bg-gradient-to-br from-primary-200/40 to-indigo-100/40 blur-3xl rounded-full -z-10" />
            <div className="relative rounded-[40px] border-[12px] border-slate-900 bg-slate-900 shadow-2xl overflow-hidden animate-float">
              <div className="relative aspect-[9/19.5] bg-gradient-to-br from-primary-500 via-primary-600 to-indigo-700 flex flex-col">
                <div className="mx-auto mt-2 h-5 w-24 rounded-full bg-slate-900" />
                <div className="flex-1 p-5 text-white flex flex-col gap-3">
                  <div className="text-xs font-medium opacity-80">{t('brand')}</div>
                  <div className="text-xl font-extrabold leading-tight">Good morning,<br/>Sara</div>
                  <div className="mt-2 rounded-2xl bg-white/15 backdrop-blur p-4">
                    <div className="text-xs opacity-80">Bus arriving</div>
                    <div className="mt-1 text-2xl font-extrabold">5 min</div>
                    <div className="mt-2 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div className="h-full w-2/3 bg-white/80" />
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/15 backdrop-blur p-4">
                    <div className="text-xs opacity-80">Today's homework</div>
                    <div className="mt-1 text-sm font-semibold">Math · Chapter 4</div>
                  </div>
                  <div className="rounded-2xl bg-white/15 backdrop-blur p-4">
                    <div className="text-xs opacity-80">Attendance</div>
                    <div className="mt-1 text-sm font-semibold">Present · 9:02 AM</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
