import type { ReactNode } from 'react';

/**
 * A clean phone body. Renders a code reproduction (`children`) today; pass a
 * real screenshot via `src` later and it takes over the screen area verbatim.
 */
export default function PhoneFrame({
  src,
  alt,
  children,
  className = '',
}: {
  src?: string;
  alt?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative rounded-[2.2rem] border border-slate-900/10 bg-slate-900 p-2 shadow-2xl shadow-slate-900/20 ${className}`}
    >
      <div className="relative overflow-hidden rounded-[1.7rem] bg-white">
        {/* notch */}
        <div className="absolute left-1/2 top-0 z-10 h-3.5 w-16 -translate-x-1/2 rounded-b-xl bg-slate-900" />
        <div className="aspect-[9/19] w-full overflow-hidden">
          {src ? <img src={src} alt={alt ?? ''} className="block h-full w-full object-cover" /> : children}
        </div>
      </div>
    </div>
  );
}
