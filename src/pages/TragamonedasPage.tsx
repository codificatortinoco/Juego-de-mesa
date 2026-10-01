import { useCallback, useEffect, useRef, useState } from 'react';
import { CardModal } from '../components/CardModal';
import castigoSound from '../assets/Tragamonedas/Castigo-soundEffect.mp3';
import premioSound from '../assets/Tragamonedas/Premio-soundEffect.mp3';
import videoBueno from '../assets/Tragamonedas/Tragamonedas-bueno.mp4';
import videoCastigo from '../assets/Tragamonedas/Tragamonedas-normal.mp4';

interface TragamonedasCard {
  id: string;
  url: string;
  category: string;
  sound: string;
}

const TRAGAMONEDAS_IMAGES = import.meta.glob('/src/assets/Tragamonedas/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function getTragamonedasSoundAndCategory(path: string): { category: string; sound: string } {
  const file = path.split('/').pop()?.toLowerCase() ?? '';
  if (file.includes('premio')) {
    return { category: 'Premio', sound: premioSound };
  }
  return { category: 'Castigo', sound: castigoSound };
}

const TRAGAMONEDAS_CARDS: TragamonedasCard[] = Object.entries(TRAGAMONEDAS_IMAGES).map(
  ([path, url]) => {
    const { category, sound } = getTragamonedasSoundAndCategory(path);
    const id = path.split('/').pop()?.replace(/\.svg$/i, '') ?? path;
    return { id, url, category, sound };
  }
);

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function TragamonedasPage() {
  const [initialCard] = useState<TragamonedasCard | null>(() =>
    TRAGAMONEDAS_CARDS.length > 0 ? pickRandom(TRAGAMONEDAS_CARDS) : null
  );
  const [current, setCurrent] = useState<TragamonedasCard | null>(initialCard);
  const [open, setOpen] = useState(true);
  const [activeVideo, setActiveVideo] = useState<string | null>(() => {
    if (!initialCard) return null;
    return initialCard.category === 'Premio' ? videoBueno : videoCastigo;
  });
  const nextCardRef = useRef<TragamonedasCard | null>(initialCard);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playCardSound = useCallback((soundUrl: string) => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      const audio = new Audio(soundUrl);
      audioRef.current = audio;
      audio.play().catch((err) => {
        void err;
      });
    } catch (err) {
      void err;
    }
  }, []);

  const drawCard = useCallback(() => {
    if (TRAGAMONEDAS_CARDS.length === 0) return;
    const next = pickRandom(TRAGAMONEDAS_CARDS);
    nextCardRef.current = next;
    setCurrent(next);
    setOpen(true);
    // Bueno (Premio) o Castigo (Normal)
    const video = next.category === 'Premio' ? videoBueno : videoCastigo;
    setActiveVideo(video);
  }, []);

  const handleVideoEnd = useCallback(() => {
    setActiveVideo(null);
    const card = nextCardRef.current || current;
    if (card) {
      playCardSound(card.sound);
    }
  }, [current, playCardSound]);

  const handleClose = useCallback(() => {
    setActiveVideo(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <div className="card-page tragamonedas-page">
      <header className="card-page-header">
        <h1 className="card-page-title">Tragamonedas</h1>
      </header>

      <main className="card-page-main">
        <button type="button" className="card-page-draw-btn" onClick={drawCard}>
          SACAR CARTA
        </button>

        <p className="card-page-meta">{TRAGAMONEDAS_CARDS.length} cartas disponibles</p>
      </main>

      <CardModal
        open={open}
        imageSrc={current?.url ?? ''}
        imageAlt={current ? `Carta de Tragamonedas: ${current.category}` : 'Carta de Tragamonedas'}
        videoSrc={activeVideo}
        soundPromptText="ACTIVAR SONIDO Y GIRAR"
        waitingButtonText="GIRANDO…"
        onVideoEnd={handleVideoEnd}
        onClose={handleClose}
        onAnotherCard={drawCard}
      />
    </div>
  );
}

export default TragamonedasPage;
