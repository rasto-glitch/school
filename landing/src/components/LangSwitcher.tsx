import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ku', label: 'کوردی' },
];

export default function LangSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const current = LANGS.find(l => l.code === i18n.language) ?? LANGS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
      >
        <Globe size={14} />
        <span>{current.label}</span>
      </button>
      {open && (
        <div className="absolute end-0 mt-2 min-w-[150px] rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden z-50">
          {LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => { i18n.changeLanguage(l.code); setOpen(false); }}
              className={`block w-full px-4 py-2 text-start text-sm hover:bg-slate-50 transition ${
                l.code === i18n.language ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-slate-700'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
