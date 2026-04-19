import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ar from './locales/ar.json';
import ku from './locales/ku.json';

const saved = localStorage.getItem('scholify-landing-lang') || 'en';

export const RTL_LANGS = ['ar', 'ku'];

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
      ku: { translation: ku },
    },
    lng: saved,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

const applyDir = (lng: string) => {
  const dir = RTL_LANGS.includes(lng) ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
};

applyDir(saved);

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('scholify-landing-lang', lng);
  applyDir(lng);
});

export default i18n;
