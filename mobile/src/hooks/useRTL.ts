import { useTranslation } from 'react-i18next';
import { isRTLLanguage } from '../i18n';

/** Returns true when the current language is right-to-left (Arabic or Kurdish). */
export function useRTL() {
  const { i18n } = useTranslation();
  return isRTLLanguage(i18n.language);
}
