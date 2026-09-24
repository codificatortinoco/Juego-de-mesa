/**
 * Generador pseudoaleatorio con seed basado en Mulberry32.
 *
 * - La misma seed produce exactamente la misma secuencia.
 * - Centraliza toda la aleatoriedad del generador de mapas.
 * - Evita llamadas directas a Math.random() en la lógica.
 */
export type Seed = number;

export function createSeededRandom(seed: Seed) {
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return arr[Math.floor(next() * arr.length)];
  }

  function shuffle<T>(arr: readonly T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function chance(p: number): boolean {
    return next() < p;
  }

  return {
    next,
    range,
    pick,
    shuffle,
    chance,
    getSeed: () => seed,
  };
}

export type SeededRandom = ReturnType<typeof createSeededRandom>;

export function generateRandomSeed(): Seed {
  return Math.floor(Math.random() * 1_000_000_000);
}

export function parseSeed(input: string | number): Seed {
  const n = typeof input === 'string' ? parseInt(input, 10) : input;
  if (isNaN(n) || !isFinite(n)) {
    return generateRandomSeed();
  }
  return Math.abs(Math.floor(n)) >>> 0;
}
