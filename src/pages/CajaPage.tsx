import { useCallback, useEffect, useMemo, useState } from 'react';
import { CardModal } from '../components/CardModal';

const CAJA_IMAGES = import.meta.glob('/src/assets/Caja/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function CajaPage() {
  const cards = useMemo(() => Object.values(CAJA_IMAGES), []);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const drawCard = useCallback(() => {
    const next = cards.length > 0 ? pickRandom(cards) : null;
    setCurrent(next);
    setOpen(true);
  }, [cards]);

  useEffect(() => {
    if (cards.length > 0) drawCard();
  }, []);

  return (
    <div className="card-page caja-page">
      <header className="card-page-header">
        <h1 className="card-page-title">📦 Caja</h1>
        <p className="card-page-subtitle">
          Saca una carta aleatoria durante la partida
        </p>
      </header>

      <main className="card-page-main">
        <button
          type="button"
          className="card-page-draw-btn"
          onClick={drawCard}
        >
          🎴 SACAR CARTA
        </button>

        <p className="card-page-meta">
          {cards.length} cartas disponibles
        </p>
      </main>

      <CardModal
        open={open}
        imageSrc={current ?? ''}
        imageAlt="Carta de Caja"
        onClose={() => setOpen(false)}
        onAnotherCard={drawCard}
      />
    </div>
  );
}

export default CajaPage;
