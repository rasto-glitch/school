import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Maximize, Minimize, AlertCircle, Loader2, QrCode } from 'lucide-react';
import { receptionApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

// Reception's stationary clock-in display (Phase 2). A big rotating QR that
// employees walk up to and scan with the app. The token rotates every 60s
// (server-signed, school-bound); we re-fetch right after each window rolls so
// the screen always shows a code the server will accept. The previous window
// is still accepted server-side, so there is never a validity gap.

type Status = 'loading' | 'ok' | 'feature_off' | 'not_configured' | 'error';

interface KioskTokenResponse {
  token: string;
  expiresInSeconds: number;
  rotateSeconds: number;
}

export default function QrDisplayPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { school } = useAuthStore();

  const [token, setToken] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // Schedule the next fetch, always cancelling any pending one first so two
  // in-flight chains (React 19 StrictMode double-mount, or any concurrent
  // call) can never leave more than one live timer.
  const schedule = useCallback((fn: () => void, ms: number) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(fn, ms);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await receptionApi.getKioskToken();
      if (!mounted.current) return;
      const data = res.data as KioskTokenResponse;
      setToken(data.token);
      setStatus('ok');
      const ttl = Math.max(1, Math.min(60, data.expiresInSeconds || 60));
      setSecondsLeft(ttl);
      // Re-fetch just after the window rolls over (+600ms guards clock skew).
      schedule(load, ttl * 1000 + 600);
    } catch (err: unknown) {
      if (!mounted.current) return;
      const e = err as { response?: { status?: number; data?: { code?: string } } };
      const code = e.response?.data?.code;
      // FEATURE_OFF / NOT_CONFIGURED are stable server-config states — they only
      // clear when an admin enables the feature / sets the secret, so poll them
      // slowly (an unattended kiosk still self-heals within ~5 min) instead of
      // hammering every 15s. Transient network errors retry quickly.
      let retryMs = 15000;
      if (e.response?.status === 403 || code === 'FEATURE_OFF') { setStatus('feature_off'); retryMs = 300000; }
      else if (e.response?.status === 503 || code === 'NOT_CONFIGURED') { setStatus('not_configured'); retryMs = 300000; }
      else setStatus('error');
      setToken(null);
      schedule(load, retryMs);
    }
  }, [schedule]);

  useEffect(() => {
    mounted.current = true;
    load();
    const tick = setInterval(() => setSecondsLeft(s => (s > 0 ? s - 1 : 0)), 1000);
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      clearInterval(tick);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [load]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  const showQr = status === 'ok' && !!token;

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full flex flex-col bg-gradient-to-b from-gray-50 to-gray-100"
    >
      {/* Top bar — hidden in fullscreen so the display is distraction-free */}
      {!isFullscreen && (
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => navigate('/reception/dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('staff_attendance.qr_back')}
          </button>
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium"
          >
            <Maximize className="w-4 h-4" />
            {t('staff_attendance.qr_fullscreen')}
          </button>
        </div>
      )}

      {/* Centre stage */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10 text-center">
        {/* School identity */}
        <div className="flex items-center gap-3 mb-6">
          {school?.logoUrl
            ? <img src={school.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain" />
            : <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center"><QrCode className="w-5 h-5 text-primary-600" /></div>}
          <span className="text-lg font-semibold text-gray-800">{school?.name ?? ''}</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">{t('staff_attendance.qr_title')}</h1>
        <p className="mt-2 text-base sm:text-lg text-gray-500 max-w-md">{t('staff_attendance.qr_subtitle')}</p>

        {/* QR / state card */}
        <div className="mt-8 bg-white rounded-3xl shadow-xl p-6 sm:p-8 flex items-center justify-center"
             style={{ width: 'min(78vw, 78vh, 560px)', height: 'min(78vw, 78vh, 560px)' }}>
          {showQr ? (
            <QRCodeSVG
              value={token!}
              level="M"
              marginSize={2}
              className="w-full h-full"
              style={{ width: '100%', height: '100%' }}
            />
          ) : status === 'loading' ? (
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <Loader2 className="w-10 h-10 animate-spin" />
              <span className="text-sm">{t('staff_attendance.qr_loading')}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-gray-500 max-w-xs">
              <AlertCircle className="w-12 h-12 text-amber-500" />
              <span className="text-base font-medium text-gray-700">
                {status === 'feature_off' && t('staff_attendance.qr_feature_off')}
                {status === 'not_configured' && t('staff_attendance.qr_not_configured')}
                {status === 'error' && t('staff_attendance.qr_error')}
              </span>
              {status === 'feature_off' && (
                <span className="text-sm text-gray-400">{t('staff_attendance.qr_feature_off_hint')}</span>
              )}
            </div>
          )}
        </div>

        {/* Instructions + countdown */}
        {showQr && (
          <>
            <p className="mt-8 text-base text-gray-600 max-w-md">{t('staff_attendance.qr_instructions')}</p>
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {t('staff_attendance.qr_refresh_in', { seconds: secondsLeft })}
            </div>
          </>
        )}

        {/* Fullscreen exit affordance (top bar is hidden in fullscreen) */}
        {isFullscreen && (
          <button
            onClick={toggleFullscreen}
            className="mt-8 flex items-center gap-2 text-gray-400 hover:text-gray-700 text-sm font-medium"
          >
            <Minimize className="w-4 h-4" />
            {t('staff_attendance.qr_exit_fullscreen')}
          </button>
        )}
      </div>
    </div>
  );
}
