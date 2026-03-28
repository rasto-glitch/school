import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';
import * as Updates from 'expo-updates';
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

// Restore saved language on startup and apply RTL silently (already in correct native state from last session)
AsyncStorage.getItem(LANGUAGE_KEY).then(saved => {
  if (saved) {
    const shouldBeRTL = isRTLLanguage(saved);
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.allowRTL(shouldBeRTL);
      I18nManager.forceRTL(shouldBeRTL);
    }
    if (saved !== i18n.language) i18n.changeLanguage(saved);
  }
});

// When language changes at runtime, update RTL direction and reload if it changed
i18n.on('languageChanged', (lang: string) => {
  const shouldBeRTL = isRTLLanguage(lang);
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
    Updates.reloadAsync().catch(() => {});
  }
});

export default i18n;
