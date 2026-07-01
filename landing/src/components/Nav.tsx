import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';
import Logo from './Logo';
import LangSwitcher from './LangSwitcher';
import ThemeToggle from './ThemeToggle';

export default function Nav() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  const anchor = (href: string, label: string) => (
    <a href={href} className="text-sm font-medium text-slate-700 hover:text-primary-600 transition dark:text-slate-300 dark:hover:text-primary-400">
      {label}
    </a>
  );

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-all ${
        scrolled
          ? 'bg-white/80 backdrop-blur-md border-slate-200/80 dark:bg-slate-950/80 dark:border-slate-800'
          : 'bg-transparent border-transparent'
      }`}
    >
      <div className="mx-auto max-w-content container-px flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center">
          <Logo />
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {pathname === '/' && (
            <>
              {anchor('#flagship', t('nav.features'))}
              {anchor('#portals', t('nav.portals'))}
              {anchor('#mobile', t('nav.mobile'))}
              {anchor('#security', t('nav.security'))}
            </>
          )}
          <Link to="/partner" className="text-sm font-medium text-slate-700 hover:text-primary-600 transition dark:text-slate-300 dark:hover:text-primary-400">
            {t('nav.partner')}
          </Link>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <LangSwitcher />
          <ThemeToggle />
          <Link
            to="/demo"
            className="rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 transition"
          >
            {t('nav.demo')}
          </Link>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => setOpen(o => !o)}
            aria-label="Menu"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="mx-auto max-w-content container-px py-4 flex flex-col gap-3">
            {pathname === '/' && (
              <>
                <a href="#flagship" className="py-2 text-slate-700 font-medium dark:text-slate-300">{t('nav.features')}</a>
                <a href="#portals" className="py-2 text-slate-700 font-medium dark:text-slate-300">{t('nav.portals')}</a>
                <a href="#mobile" className="py-2 text-slate-700 font-medium dark:text-slate-300">{t('nav.mobile')}</a>
                <a href="#security" className="py-2 text-slate-700 font-medium dark:text-slate-300">{t('nav.security')}</a>
              </>
            )}
            <Link to="/partner" className="py-2 text-slate-700 font-medium dark:text-slate-300">{t('nav.partner')}</Link>
            <div className="flex items-center gap-3 pt-2">
              <LangSwitcher />
              <Link
                to="/demo"
                className="flex-1 text-center rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white"
              >
                {t('nav.demo')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
