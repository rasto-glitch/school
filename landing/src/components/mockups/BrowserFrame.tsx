import type { ReactNode } from 'react';

/**
 * A lightweight browser chrome. Renders a code reproduction (`children`) today;
 * drop in a real screenshot later by passing `src` — no other change needed.
 */
export default function BrowserFrame({
  url = 'app.scholify.krd',
  src,
  alt,
  children,
  className = '',
}: {
  url?: string;
  src?: string;
  alt?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 ${className}`}
    >
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        </div>
        <div className="mx-auto flex max-w-[60%] items-center gap-1.5 truncate rounded-md bg-white px-3 py-1 text-[11px] font-medium text-slate-400 ring-1 ring-slate-200">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <path d="M6 10V8a6 6 0 1112 0v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <rect x="4" y="10" width="16" height="10" rx="2" fill="currentColor" opacity="0.3" />
          </svg>
          {url}
        </div>
      </div>
      {/* viewport */}
      <div className="bg-white">
        {src ? <img src={src} alt={alt ?? ''} className="block w-full" /> : children}
      </div>
    </div>
  );
}
