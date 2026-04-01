import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import Header from './Header';

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  raw?: boolean;
}

export default function PageLayout({ title, subtitle, children, raw }: PageLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { i18n } = useTranslation();
  const isRTL = ['ar', 'ku'].includes(i18n.language);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className={`flex h-screen bg-gray-50 ${isRTL ? 'font-arabic' : ''}`}>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${isRTL ? (collapsed ? 'lg:mr-16' : 'lg:mr-64') : (collapsed ? 'lg:ml-16' : 'lg:ml-64')}`}>
        <Header title={title} subtitle={subtitle} onMenuClick={() => setMobileOpen(true)} />
        <main className={raw ? 'flex-1 overflow-hidden flex flex-col' : 'flex-1 overflow-y-auto p-4 sm:p-6'}>
          {children}
        </main>
      </div>
    </div>
  );
}
