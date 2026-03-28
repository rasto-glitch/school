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

// Restore saved language on startup and apply the correct RTL state silently
AsyncStorage.getItem(LANGUAGE_KEY).then(saved => {
  if (saved) {
    const shouldBeRTL = isRTLLanguage(saved);
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
    if (saved !== i18n.language) i18n.changeLanguage(saved);
  }
});

/**
 * Change the app language, persist it, update RTL direction, and reload if
 * the layout direction actually changed (RTL ↔ LTR transition).
 * Always call this instead of i18n.changeLanguage() directly.
 *
 * Reload may silently fail in development builds — RTL will apply on next
 * native restart in that case (language is always persisted first).
 */
export async function changeLanguageAndApply(code: string) {
  const previouslyRTL = I18nManager.isRTL;
  const willBeRTL = isRTLLanguage(code);

  // 1. Persist first — so that after any reload the correct language is restored
  await AsyncStorage.setItem(LANGUAGE_KEY, code);

  // 2. Update i18n strings immediately (UI text updates without reload)
  await i18n.changeLanguage(code);

  // 3. Update native RTL state
  I18nManager.allowRTL(willBeRTL);
  I18nManager.forceRTL(willBeRTL);

  // 4. Reload only when layout direction actually changes.
  //    Updates.reloadAsync() throws in development/embedded builds — catch it
  //    so the caller never crashes. RTL will take effect on the next native restart.
  if (previouslyRTL !== willBeRTL) {
    try {
      await Updates.reloadAsync();
    } catch {
      // Reload unavailable (dev build or embedded bundle) — RTL applies on next launch
    }
  }
}

export default i18n;
