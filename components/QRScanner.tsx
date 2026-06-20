'use client';

import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export default function QRScanner({ onResult }: { onResult: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    const reader = new BrowserMultiFormatReader();

    try {
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (result) {
            onResult(result.getText());
            controlsRef.current?.stop();
            setActive(false);
          }
        }
      );
      controlsRef.current = controls;
      setActive(true);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Não foi possível abrir a câmera.');
    }
  }

  function stop() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setActive(false);
  }

  useEffect(() => stop, []);

  return (
    <div className="scanner">
      <video ref={videoRef} className="scanner-video" muted playsInline />
      {error && <p className="error-text">{error}</p>}
      <div className="actions">
        <button className="button" onClick={start} disabled={active}>
          <Camera size={18} /> Abrir câmera
        </button>
        <button className="button secondary" onClick={stop} disabled={!active}>
          <Square size={18} /> Parar
        </button>
      </div>
    </div>
  );
}
