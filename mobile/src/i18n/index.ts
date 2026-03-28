import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './locales/en.json';
import ar from './locales/ar.json';
import ku from './locales/ku.json';

export const LANGUAGE_KEY = '@app_language';
export const RTL_LANGS = ['ar', 'ku'];

export function isRTLLanguage(lang: string) {
  return RTL_LANGS.includes(lang);
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar }, ku: { translation: ku } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Restore saved language on startup
AsyncStorage.getItem(LANGUAGE_KEY).then(saved => {
  if (saved && saved !== i18n.language) i18n.changeLanguage(saved);
});

/**
 * Change the app language and persist it.
 * RTL is handled purely via CSS (direction style prop) — no I18nManager, no restart.
 */
export async function changeLanguageAndApply(code: string) {
  await AsyncStorage.setItem(LANGUAGE_KEY, code);
  await i18n.changeLanguage(code);
}

export default i18n;
