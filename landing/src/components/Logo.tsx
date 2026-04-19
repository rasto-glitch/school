import { useTranslation } from 'react-i18next';

export default function Logo({ size = 28 }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#6366F1" />
        <path d="M9 12l7-4 7 4v2l-7 4-7-4v-2zm0 4l7 4 7-4v4l-7 4-7-4v-4z" fill="#fff" />
      </svg>
      <span className="text-lg font-extrabold tracking-tight text-slate-900">
        {t('brand')}
      </span>
    </div>
  );
}
