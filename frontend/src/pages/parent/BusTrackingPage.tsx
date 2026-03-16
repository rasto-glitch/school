import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Bus, RefreshCw, Phone, CreditCard, User, Clock } from 'lucide-react';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Student } from '../../types';
import { io as socketIO } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

interface BusData {
  location: {
    driverId: string;
    latitude: number;
    longitude: number;
    isDriving: boolean;
    drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; buses?: { busNumber: string } };
  };
  studentHome: { latitude: number; longitude: number };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeETA(busLat: number, busLng: number, targetLat: number, targetLng: number, speedMs: number): string {
  const distKm = haversineKm(busLat, busLng, targetLat, targetLng);
  const speedKmh = speedMs > 1 ? speedMs * 3.6 : 30;
  const etaMs = (distKm / speedKmh) * 3600000;
  const eta = new Date(Date.now() + etaMs);
  return eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function BusTrackingPage() {
  const { t } = useTranslation();
  const { token } = useAuthStore();
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [busData, setBusData] = useState<BusData | null>(null);
  const [absent, setAbsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [_map, setMap] = useState<google.maps.Map | null>(null);
  const [parentLocation, setParentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [busSpeed, setBusSpeed] = useState(0);

  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_API_KEY });

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const kids = r.data || [];
      setChildren(kids);
      if (kids.length > 0) setSelectedChild(kids[0].id);
    });
  }, []);

  // Track parent's location, refresh every 5 minutes
  useEffect(() => {
    if (!navigator.geolocation) return;
    const getLocation = () => {
      navigator.geolocation.getCurrentPosition(
        pos => setParentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    };
    getLocation();
    const interval = setInterval(getLocation, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const reset = useCallback(() => {
    setBusData(null);
    setAbsent(false);
  }, []);

  const fetchBusLocation = useCallback(() => {
    if (!selectedChild) return;
    setLoading(true);
    parentApi.getBusLocation(selectedChild)
      .then(r => {
        setBusData(r.data);
        setAbsent(false);
      })
      .catch((err) => {
        const msg: string = err.response?.data?.error || '';
        setBusData(null);
        setAbsent(msg.toLowerCase().includes('absent'));
      })
      .finally(() => setLoading(false));
  }, [selectedChild]);

  // Poll every 30 seconds
  useEffect(() => {
    reset();
    fetchBusLocation();
    const interval = setInterval(fetchBusLocation, 30000);
    return () => clearInterval(interval);
  }, [fetchBusLocation, reset]);

  // Socket.io — join driver room when we have an active drive
  useEffect(() => {
    const driverId = busData?.location?.driverId;
    if (!driverId) return;
    const socket = socketIO(SOCKET_URL, { transports: ['websocket'], auth: { token } });
    socket.emit('watchDriver', driverId);
    socket.on('locationUpdate', (data: { latitude: number; longitude: number; isDriving: boolean; speed?: number }) => {
      if (data.speed !== undefined) setBusSpeed(data.speed);
      setBusData(prev => prev ? {
        ...prev,
        location: { ...prev.location, latitude: data.latitude, longitude: data.longitude, isDriving: data.isDriving }
      } : prev);
    });
    socket.on('driveEnded', () => { reset(); });
    return () => { socket.disconnect(); };
  }, [busData?.location?.driverId, reset]);

  const isActive = !!busData?.location?.isDriving;
  const selectedChildData = children.find(c => c.id === selectedChild);
  const driverInfo = isActive ? busData?.location?.drivers : selectedChildData?.drivers;
  const center = busData?.location
    ? { lat: busData.location.latitude, lng: busData.location.longitude }
    : { lat: 25.2048, lng: 55.2708 };

  // ETA — use parent's live location if available, fall back to student home
  const etaTarget = parentLocation ?? (
    busData?.studentHome?.latitude
      ? { lat: busData.studentHome.latitude, lng: busData.studentHome.longitude }
      : null
  );
  const etaTime = isActive && busData?.location && etaTarget
    ? computeETA(busData.location.latitude, busData.location.longitude, etaTarget.lat, etaTarget.lng, busSpeed)
    : null;

  return (
    <PageLayout title={t('bus.title')} subtitle={t('bus.subtitle')}>
      <div className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-36 max-w-56">
            <Select
              label={t('bus.select_child')}
              options={children.map(c => ({ value: c.id, label: c.fullName }))}
              value={selectedChild}
              onChange={e => setSelectedChild(e.target.value)}
            />
          </div>
          <Button variant="outline" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchBusLocation} loading={loading}>
            {t('bus.refresh')}
          </Button>
        </div>

        {/* Absent notice */}
        {absent && (
          <Card className="bg-amber-50 border-amber-200">
            <div className="flex items-center gap-2">
              <Bus className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-700">{t('bus.absent_message')}</p>
            </div>
          </Card>
        )}

        {/* Not active — clean slate */}
        {!isActive && !absent && !loading && (
          <Card className="bg-gray-50 border-gray-100">
            <div className="flex items-center gap-3 py-2">
              <div className="p-2 bg-gray-100 rounded-xl">
                <Bus className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">{t('bus.not_active')}</p>
                <p className="text-xs text-gray-400">{t('bus.not_active_desc')}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Active status cards */}
        {isActive && busData && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card className="flex items-center gap-3">
                <div className="p-2 bg-green-50 rounded-xl">
                  <Bus className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{t('bus.bus_active')}</p>
                  <p className="text-xs text-gray-500">{t('bus.bus_number', { number: busData.location.drivers?.buses?.busNumber || 'N/A' })}</p>
                </div>
                <span className="ml-auto relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
              </Card>
              <Card className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-xl">
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{t('bus.live_location')}</p>
                  <p className="text-xs text-gray-500">{t('bus.updates_interval')}</p>
                </div>
              </Card>
            </div>

            {/* ETA card */}
            {etaTime && (
              <Card className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 rounded-xl flex-shrink-0">
                  <Clock className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">{t('bus.arrives_at')}</p>
                  <p className="text-2xl font-bold text-gray-900 leading-none">{etaTime}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {parentLocation ? t('bus.eta_your_location') : t('bus.eta_home_location')}
                  </p>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Driver info — always shown when a driver is assigned */}
        {driverInfo && (
          <Card>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('bus.driver_info')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400">{t('bus.driver_name')}</p>
                  <p className="text-sm font-medium text-gray-900">{driverInfo.fullName || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400">{t('bus.license')}</p>
                  <p className="text-sm font-medium text-gray-900">{driverInfo.licenseNumber || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400">{t('bus.phone')}</p>
                  {driverInfo.phoneNumber ? (
                    <a href={`tel:${driverInfo.phoneNumber}`} className="text-sm font-medium text-primary-600 hover:underline">
                      {driverInfo.phoneNumber}
                    </a>
                  ) : (
                    <p className="text-sm font-medium text-gray-900">—</p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Map — only shown when drive is active */}
        {isActive && (
          <Card className="p-0 overflow-hidden h-[280px] sm:h-[450px]">
            {!isLoaded ? <LoadingSpinner /> : (
              <GoogleMap
                mapContainerStyle={{ width: '100%', height: '100%' }}
                center={center}
                zoom={14}
                onLoad={setMap}
              >
                {/* Bus marker */}
                <Marker
                  position={{ lat: busData!.location.latitude, lng: busData!.location.longitude }}
                  icon={{
                    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
                        <circle cx="20" cy="20" r="18" fill="#4F46E5" stroke="white" stroke-width="3"/>
                        <text x="20" y="26" font-size="18" text-anchor="middle" fill="white">🚌</text>
                      </svg>
                    `),
                    scaledSize: new window.google.maps.Size(40, 40),
                  }}
                />
                {/* Student home marker */}
                {busData?.studentHome?.latitude && (
                  <Marker
                    position={{ lat: busData.studentHome.latitude, lng: busData.studentHome.longitude }}
                    icon={{
                      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
                          <circle cx="20" cy="20" r="18" fill="#10B981" stroke="white" stroke-width="3"/>
                          <text x="20" y="26" font-size="18" text-anchor="middle" fill="white">🏠</text>
                        </svg>
                      `),
                      scaledSize: new window.google.maps.Size(40, 40),
                    }}
                  />
                )}
                {/* Parent's current location marker */}
                {parentLocation && (
                  <Marker
                    position={parentLocation}
                    icon={{
                      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
                          <circle cx="20" cy="20" r="18" fill="#F59E0B" stroke="white" stroke-width="3"/>
                          <text x="20" y="26" font-size="18" text-anchor="middle" fill="white">📍</text>
                        </svg>
                      `),
                      scaledSize: new window.google.maps.Size(40, 40),
                    }}
                  />
                )}
              </GoogleMap>
            )}
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
