import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

// Minimal language picker rendered on the unauthenticated screens
// (login / forgot-password / recover-account / force-change-password).
// Authenticated users get a richer picker inside AccountSettingsModal —
// this one is intentionally tiny so it doesn't compete with the form.
//
// Persistence + RTL flip happens centrally inside i18n/index.ts on
// 'languageChanged'; this component just calls i18n.changeLanguage.

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ku', label: 'کوردی' },
];

export default function PreLoginLanguageSwitcher() {
  const { i18n } = useTranslation();
  return (
    <div className="fixed top-4 right-4 z-50">
      <label className="inline-flex items-center gap-2 bg-white/95 backdrop-blur border border-gray-200 rounded-xl px-3 py-1.5 shadow-sm">
        <Globe className="w-4 h-4 text-gray-500" aria-hidden="true" />
        <select
          aria-label="Language"
          value={i18n.language}
          onChange={e => i18n.changeLanguage(e.target.value)}
          className="bg-transparent text-sm text-gray-900 focus:outline-none cursor-pointer"
        >
          {LANGUAGES.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
