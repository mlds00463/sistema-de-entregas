'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Coordinates = {
  latitude: number;
  longitude: number;
};

export function useGeolocation() {
  const watchId = useRef<number | null>(null);
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);

  const requestOnce = useCallback(() => {
    return new Promise<Coordinates>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('GPS não disponível neste navegador.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nextCoords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          setCoords(nextCoords);
          setError(null);
          resolve(nextCoords);
        },
        (geoError) => {
          setError(geoError.message);
          reject(geoError);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    });
  }, []);

  const startWatching = useCallback((onUpdate?: (coordinates: Coordinates) => void) => {
    if (!navigator.geolocation || watchId.current !== null) return;

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const nextCoords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCoords(nextCoords);
        setError(null);
        onUpdate?.(nextCoords);
      },
      (geoError) => setError(geoError.message),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 }
    );
    setWatching(true);
  }, []);

  const stopWatching = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setWatching(false);
  }, []);

  useEffect(() => stopWatching, [stopWatching]);

  return { coords, error, watching, requestOnce, startWatching, stopWatching };
}
