import { useCallback, useMemo, useState } from "react";
import { CardModal } from "../components/CardModal";

const TRAGAMONEDAS_IMAGES = import.meta.glob("/src/assets/Tragamonedas/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function TragamonedasPage() {
  const cards = useMemo(() => Object.values(TRAGAMONEDAS_IMAGES), []);
  const [current, setCurrent] = useState<string | null>(() =>
    cards.length > 0 ? pickRandom(cards) : null
  );
  const [open, setOpen] = useState(() => cards.length > 0);

  const drawCard = useCallback(() => {
    const next = cards.length > 0 ? pickRandom(cards) : null;
    setCurrent(next);
    setOpen(true);
  }, [cards]);

  return (
    <div className="card-page tragamonedas-page">
      <header className="card-page-header">
        <h1 className="card-page-title">🎰 Tragamonedas</h1>
      </header>

      <main className="card-page-main">
        <button type="button" className="card-page-draw-btn" onClick={drawCard}>
          🎴 SACAR CARTA
        </button>

        <p className="card-page-meta">{cards.length} cartas disponibles</p>
      </main>

      <CardModal
        open={open}
        imageSrc={current ?? ""}
        imageAlt="Carta de Tragamonedas"
        onClose={() => setOpen(false)}
        onAnotherCard={drawCard}
      />
    </div>
  );
}

export default TragamonedasPage;
