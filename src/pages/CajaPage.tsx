import { useCallback, useEffect, useRef, useState } from 'react';
import { CardModal } from '../components/CardModal';
import apuestaSound from '../assets/Caja/Apuesta-soundEffect.mp3';
import buenoSound from '../assets/Caja/Bueno-soundEffect.mp3';
import caosSound from '../assets/Caja/Caos-soundEffect.mp3';
import dueloSound from '../assets/Caja/Duelo-soundEffect.mp3';
import maloSound from '../assets/Caja/Malo-soundEffect.mp3';
import videoApuesta from '../assets/Caja/Apuesta.mp4';
import videoBueno from '../assets/Caja/Bueno.mp4';
import videoCaos from '../assets/Caja/Caos.mp4';
import videoDuelo from '../assets/Caja/Duelo.mp4';
import videoMalo from '../assets/Caja/Malo.mp4';

interface CajaCard {
  id: string;
  url: string;
  category: string;
  sound: string;
}

const CAJA_IMAGES = import.meta.glob('/src/assets/Caja/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function getCajaSoundAndCategory(path: string): { category: string; sound: string } {
  const file = path.split('/').pop()?.toLowerCase() ?? '';
  if (file.includes('apuesta') || file.includes('aupesta')) {
    return { category: 'Apuesta', sound: apuestaSound };
  }
  if (file.includes('bueno')) {
    return { category: 'Bueno', sound: buenoSound };
  }
  if (file.includes('caos')) {
    return { category: 'Caos', sound: caosSound };
  }
  if (file.includes('duelo')) {
    return { category: 'Duelo', sound: dueloSound };
  }
  return { category: 'Malo', sound: maloSound };
}

function getCajaVideo(category: string): string {
  switch (category) {
    case 'Apuesta':
      return videoApuesta;
    case 'Bueno':
      return videoBueno;
    case 'Caos':
      return videoCaos;
    case 'Duelo':
      return videoDuelo;
    case 'Malo':
    default:
      return videoMalo;
  }
}

const CAJA_CARDS: CajaCard[] = Object.entries(CAJA_IMAGES).map(([path, url]) => {
  const { category, sound } = getCajaSoundAndCategory(path);
  const id = path.split('/').pop()?.replace(/\.svg$/i, '') ?? path;
  return { id, url, category, sound };
});

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function CajaPage() {
  const [initialCard] = useState<CajaCard | null>(() =>
    CAJA_CARDS.length > 0 ? pickRandom(CAJA_CARDS) : null
  );
  const [current, setCurrent] = useState<CajaCard | null>(initialCard);
  const [open, setOpen] = useState(true);
  const [activeVideo, setActiveVideo] = useState<string | null>(() => {
    if (!initialCard) return null;
    return getCajaVideo(initialCard.category);
  });
  const nextCardRef = useRef<CajaCard | null>(initialCard);
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
    if (CAJA_CARDS.length === 0) return;
    const next = pickRandom(CAJA_CARDS);
    nextCardRef.current = next;
    setCurrent(next);
    setOpen(true);
    const video = getCajaVideo(next.category);
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
    <div className="card-page caja-page">
      <header className="card-page-header">
        <h1 className="card-page-title">Caja</h1>
      </header>

      <main className="card-page-main">
        <button type="button" className="card-page-draw-btn" onClick={drawCard}>
          SACAR CARTA
        </button>

        <p className="card-page-meta">{CAJA_CARDS.length} cartas disponibles</p>
      </main>

      <CardModal
        open={open}
        imageSrc={current?.url ?? ''}
        imageAlt={current ? `Carta de Caja: ${current.category}` : 'Carta de Caja'}
        videoSrc={activeVideo}
        soundPromptText="ACTIVAR SONIDO Y ABRIR"
        waitingButtonText="ABRIENDO…"
        onVideoEnd={handleVideoEnd}
        onClose={handleClose}
        onAnotherCard={drawCard}
      />
    </div>
  );
}

export default CajaPage;
