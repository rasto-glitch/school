import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Logo from './Logo';

export default function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mx-auto max-w-content container-px py-14 grid gap-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-4 text-sm text-slate-600 max-w-sm dark:text-slate-400">{t('footer.tagline')}</p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-900 mb-3 dark:text-white">{t('footer.product')}</h4>
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
            <li><Link to="/demo" className="hover:text-primary-600 dark:hover:text-primary-400">{t('nav.demo')}</Link></li>
            <li><Link to="/partner" className="hover:text-primary-600 dark:hover:text-primary-400">{t('nav.partner')}</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-900 mb-3 dark:text-white">{t('footer.legal')}</h4>
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
            <li><Link to="/privacy" className="hover:text-primary-600 dark:hover:text-primary-400">{t('footer.privacy')}</Link></li>
            <li><Link to="/terms" className="hover:text-primary-600 dark:hover:text-primary-400">{t('footer.terms')}</Link></li>
            <li><Link to="/contact" className="hover:text-primary-600 dark:hover:text-primary-400">{t('footer.contact')}</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-content container-px py-5 text-xs text-slate-500 flex flex-col sm:flex-row justify-between gap-2 dark:text-slate-500">
          <div>© {year} {t('brand')}. {t('footer.rights')}</div>
          <div>scholify.krd</div>
        </div>
      </div>
    </footer>
  );
}
