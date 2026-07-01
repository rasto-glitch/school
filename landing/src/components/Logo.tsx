import { useTranslation } from 'react-i18next';

export default function Logo({ size = 28 }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <img src="/logo.png" alt="Scholify" width={size} height={size} className="rounded-lg" />
      <span className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
        {t('brand')}
      </span>
    </div>
  );
}
