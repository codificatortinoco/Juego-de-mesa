import { useCallback, useEffect, useRef, useState } from 'react';

type CardModalProps = {
  open: boolean;
  imageSrc: string;
  imageAlt?: string;
  videoSrc?: string | null;
  soundPromptText?: string;
  waitingButtonText?: string;
  onVideoEnd?: () => void;
  onClose: () => void;
  onAnotherCard: () => void;
};

export function CardModal({
  open,
  imageSrc,
  imageAlt = 'Carta',
  videoSrc = null,
  soundPromptText = 'ACTIVAR SONIDO',
  waitingButtonText = 'REPRODUCIENDO…',
  onVideoEnd,
  onClose,
  onAnotherCard,
}: CardModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const { style } = document.body;
    const prev = style.overflow;
    style.overflow = 'hidden';
    closeBtnRef.current?.focus?.();
    return () => {
      window.removeEventListener('keydown', onKey);
      style.overflow = prev;
    };
  }, [open, onClose]);

  const handleUnlockSound = useCallback(() => {
    setSoundBlocked(false);
    const v = videoRef.current;
    if (v) {
      v.muted = false;
      v.currentTime = 0;
      v.play().catch((err) => {
        console.warn('Error al reproducir video con sonido:', err);
      });
    }
  }, []);

  useEffect(() => {
    if (!videoSrc) return;
    const v = videoRef.current;
    if (!v) return;

    v.muted = false;
    v.currentTime = 0;
    const playPromise = v.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setSoundBlocked(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          // El navegador bloqueó el autoplay con sonido por política de interacción previa
          setSoundBlocked(true);
          v.pause();
          v.currentTime = 0;
        });
    }
  }, [videoSrc]);

  // Listener global: cuando el sonido está bloqueado, cualquier clic o tecla inicia la reproducción con sonido
  useEffect(() => {
    if (!open || !soundBlocked) return;

    const onUserGesture = (e: MouseEvent | KeyboardEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.cm-close-x, .cm-btn-secondary')) {
        return;
      }
      handleUnlockSound();
    };

    window.addEventListener('pointerdown', onUserGesture, { capture: true, once: true });
    window.addEventListener('keydown', onUserGesture, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
    };
  }, [open, soundBlocked, handleUnlockSound]);

  if (!open) return null;

  return (
    <div
      className="cm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-modal="true"
      role="dialog"
      aria-label={imageAlt}
    >
      <div className="cm-dialog" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeBtnRef}
          className="cm-close-x"
          onClick={onClose}
          aria-label="Cerrar modal"
          type="button"
        >
          ✕
        </button>

        <div className="cm-image-wrap">
          {videoSrc ? (
            <div className="cm-video-wrapper">
              <video
                ref={videoRef}
                key={videoSrc}
                src={videoSrc}
                playsInline
                preload="auto"
                className="cm-card-image cm-card-video"
                onEnded={onVideoEnd}
                onClick={soundBlocked ? handleUnlockSound : onVideoEnd}
                title={soundBlocked ? `Haz clic para ${soundPromptText.toLowerCase()}` : 'Click para saltar'}
              />
              {soundBlocked && (
                <div className="cm-sound-overlay" onClick={handleUnlockSound}>
                  <button
                    type="button"
                    className="cm-sound-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnlockSound();
                    }}
                  >
                    <span className="cm-sound-icon">🔊</span>
                    <span className="cm-sound-text">{soundPromptText}</span>
                  </button>
                  <span className="cm-sound-hint">Haz clic en cualquier lugar para iniciar con sonido</span>
                </div>
              )}
            </div>
          ) : (
            <img
              src={imageSrc}
              alt={imageAlt}
              className="cm-card-image"
              loading="eager"
              draggable={false}
            />
          )}
        </div>

        <div className="cm-actions">
          <button
            type="button"
            className="cm-btn cm-btn-secondary"
            onClick={onClose}
          >
            CERRAR
          </button>
          <button
            type="button"
            className="cm-btn cm-btn-primary"
            onClick={soundBlocked ? handleUnlockSound : onAnotherCard}
            disabled={Boolean(videoSrc) && !soundBlocked}
          >
            {soundBlocked ? soundPromptText : videoSrc ? waitingButtonText : 'OTRA CARTA'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CardModal;
