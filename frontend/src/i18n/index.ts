import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ar from './locales/ar.json';
import ku from './locales/ku.json';

const savedLang = localStorage.getItem('app-language') || 'en';

// Arabic + Kurdish (Sorani) render right-to-left. Set <html dir="rtl">
// at boot AND on every languageChanged so pre-login screens — which
// don't go through PageLayout — flip correctly when the user picks ar/ku
// from the pre-login language switcher.
const RTL_LANGS = new Set(['ar', 'ku']);
const applyDirection = (lng: string) => {
  if (typeof document !== 'undefined') {
    document.documentElement.dir = RTL_LANGS.has(lng) ? 'rtl' : 'ltr';
    document.documentElement.lang = lng;
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ar: { translation: ar }, ku: { translation: ku } },
    lng: savedLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

applyDirection(savedLang);

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('app-language', lng);
  applyDirection(lng);
});

export default i18n;
