import { useEffect, useRef } from 'react';

type CardModalProps = {
  open: boolean;
  imageSrc: string;
  imageAlt?: string;
  onClose: () => void;
  onAnotherCard: () => void;
};

export function CardModal({
  open,
  imageSrc,
  imageAlt = 'Carta',
  onClose,
  onAnotherCard,
}: CardModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

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
          <img
            src={imageSrc}
            alt={imageAlt}
            className="cm-card-image"
            loading="eager"
            draggable={false}
          />
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
            onClick={onAnotherCard}
          >
            OTRA CARTA
          </button>
        </div>
      </div>
    </div>
  );
}

export default CardModal;
