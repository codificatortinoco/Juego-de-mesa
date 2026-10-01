import buttonClickUrl from '../assets/Tablero/clickButton-soundEffect.mp3';
import createMapUrl from '../assets/Tablero/CrearMapa-soundEffect.mp3';

const clickAudioPool: HTMLAudioElement[] = [];
const POOL_SIZE = 4;
let poolIndex = 0;

export function playButtonClickSound() {
  try {
    if (clickAudioPool.length === 0) {
      for (let i = 0; i < POOL_SIZE; i++) {
        const a = new Audio(buttonClickUrl);
        a.volume = 0.8;
        clickAudioPool.push(a);
      }
    }
    const audio = clickAudioPool[poolIndex % clickAudioPool.length];
    poolIndex++;
    audio.currentTime = 0;
    audio.play().catch((err) => {
      void err;
    });
  } catch (err) {
    void err;
  }
}

let mapAudio: HTMLAudioElement | null = null;

export function playCreateMapSound() {
  try {
    if (!mapAudio) {
      mapAudio = new Audio(createMapUrl);
      mapAudio.volume = 0.9;
    }
    mapAudio.currentTime = 0;
    mapAudio.play().catch((err) => {
      void err;
    });
  } catch (err) {
    void err;
  }
}
