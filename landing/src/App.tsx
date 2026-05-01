import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Nav from './components/Nav';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import RequestDemoPage from './pages/RequestDemoPage';
import PartnerPage from './pages/PartnerPage';
import ContactPage from './pages/ContactPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';

function AnimatedRoutes() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/demo" element={<RequestDemoPage />} />
          <Route path="/partner" element={<PartnerPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <AnimatedRoutes />
      </main>
      <Footer />
    </div>
  );
}
