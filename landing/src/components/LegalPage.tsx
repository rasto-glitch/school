import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { legal, type Lang } from '../content/legal';

type Props = {
  doc: 'privacy' | 'terms';
};

export default function LegalPage({ doc }: Props) {
  const { i18n, t } = useTranslation();
  const lang: Lang = (['en', 'ar', 'ku'].includes(i18n.language) ? i18n.language : 'en') as Lang;
  const content = legal[doc][lang];

  useEffect(() => {
    document.title = `${content.title} · Scholify`;
  }, [content.title]);

  return (
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-3xl container-px">
        <header className="mb-10 border-b border-slate-200 pb-8">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">
            {content.title}
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            {t('legal.lastUpdated')}: {content.lastUpdated}
          </p>
        </header>

        <div className="space-y-10">
          {content.sections.map((s) => (
            <div key={s.heading}>
              <h2 className="text-xl font-bold text-slate-900 mb-3">{s.heading}</h2>

              {s.paragraphs?.map((p, i) => (
                <p key={i} className="text-slate-700 leading-relaxed mb-3">
                  {p}
                </p>
              ))}

              {s.list && (
                <ul className="list-disc ps-6 space-y-2 text-slate-700 leading-relaxed">
                  {s.list.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
