import { useTranslation } from 'react-i18next';
import PageLayout from '../layout/PageLayout';

// Shown when someone deep-links to a page whose master-provisioned feature
// flag is off (the sidebar already hides the nav entry). The backend rejects
// the underlying routes with 403 FEATURE_DISABLED either way — this just
// keeps the page from rendering a broken shell of failed requests.
export default function FeatureNotEnabled({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <PageLayout title={title}>
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
        <h3 className="font-semibold text-amber-900 mb-1">
          {t('common.feature_not_enabled_title', 'This feature is not enabled')}
        </h3>
        <p className="text-sm text-amber-800">
          {t('common.feature_not_enabled_body', "Your school's plan does not include this feature. Contact the platform operator to enable it.")}
        </p>
      </div>
    </PageLayout>
  );
}
