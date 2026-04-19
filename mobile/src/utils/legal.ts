import * as WebBrowser from 'expo-web-browser';
import i18n from '../i18n';

export const openLegalPage = (doc: 'privacy' | 'terms') => {
  const lang = i18n.language || 'en';
  return WebBrowser.openBrowserAsync(`https://scholify.krd/${doc}?lang=${lang}`);
};
