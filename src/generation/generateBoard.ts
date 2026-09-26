/**
 * Orquestador principal del generador procedural.
 *
 * Flujo:
 *  1. generar estructura de rutas (geometría, pasos, ramas)
 *  2. asignar colores por paso
 *  3. asignar categorías/tipos a cada celda
 *  4. validar: conectividad, inventario, patrón, desvíos
 *  5. si no pasa, hasta N intentos → relajar separación
 *
 * La seed controla todo el flujo pseudoaleatorio para reproducibilidad.
 */
import {
  createSeededRandom,
  generateRandomSeed,
  parseSeed,
  type Seed,
  type SeededRandom,
} from './seededRandom';
import { generatePathStructure, type PathResult } from './generatePath';
import { assignColorsToPath, type ColorAssignment } from './assignColors';
import { assignTilesToPath, type TileAssignmentResult } from './assignTiles';
import {
  validateBoard,
  validateColorPattern,
  validateIntersectionContinuity,
  type ValidationResult,
} from './validateBoard';
import type { PlacedTile } from '../data/tiles';
import type { TileCategory } from '../data/tileInventory';

export interface BoardResult {
  tiles: Map<string, PlacedTile>;
  pathResult: PathResult;
  colorAssignments: Map<string, ColorAssignment>;
  usage: Record<TileCategory, number>;
  validation: ValidationResult;
  seed: Seed;
  attempts: number;
  width: number;
  height: number;
  relaxedSeparation: boolean;
}

const MAX_ATTEMPTS = 100;

export type Difficulty = 'tranquila' | 'moderada' | 'loca';

export interface DifficultyConfig {
  key: Difficulty;
  gridWidth: number;
  gridHeight: number;
  minTiles: number;
  maxTiles: number;
  minBranchLength: number;
  desiredFinals: number;
  desvioBudget: number;
  intersectionProbability: number;
  turnProbability: number;
  allowedCategories: TileCategory[];
  only1StarPuntos: boolean;
  puntosDensity: number;
  allow4WayIntersection: boolean;
  minCajaMagica?: number;
  maxCajaMagica?: number;
  maxTragaMonedas?: number;
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  tranquila: {
    key: 'tranquila',
    gridWidth: 14,
    gridHeight: 14,
    minTiles: 24,
    maxTiles: 48,
    minBranchLength: 25,
    desiredFinals: 1,
    desvioBudget: 0,
    intersectionProbability: 0,
    turnProbability: 0.35,
    allowedCategories: ['normal', 'curve', 'inicio', 'final', 'puntos', 'avanzar', 'retroceder', 'cajaMagica', 'tragaMonedas'],
    only1StarPuntos: true,
    puntosDensity: 0.14,
    allow4WayIntersection: false,
    minCajaMagica: 1,
    maxCajaMagica: 3,
    maxTragaMonedas: 1,
  },
  moderada: {
    key: 'moderada',
    gridWidth: 15,
    gridHeight: 15,
    minTiles: 30,
    maxTiles: 60,
    minBranchLength: 25,
    desiredFinals: 2,
    desvioBudget: 3,
    intersectionProbability: 0.27,
    turnProbability: 0.32,
    allowedCategories: ['normal', 'curve', 'inicio', 'final', 'puntos', 'avanzar', 'retroceder', 'desvio', 'carcel', 'cajaMagica', 'tragaMonedas'],
    only1StarPuntos: false,
    puntosDensity: 0.12,
    allow4WayIntersection: false,
    minCajaMagica: 0,
    maxCajaMagica: 3,
    maxTragaMonedas: 2,
  },
  loca: {
    key: 'loca',
    gridWidth: 18,
    gridHeight: 18,
    minTiles: 30,
    maxTiles: 70,
    minBranchLength: 25,
    desiredFinals: 3,
    desvioBudget: 6,
    intersectionProbability: 0.4,
    turnProbability: 0.34,
    allowedCategories: ['normal', 'curve', 'inicio', 'final', 'puntos', 'avanzar', 'retroceder', 'desvio', 'carcel', 'cajaMagica', 'tragaMonedas', 'portal'],
    only1StarPuntos: false,
    puntosDensity: 0.1,
    allow4WayIntersection: true,
  },
};

function tryOnce(
  rng: SeededRandom,
  attemptBase: number,
  relaxSeparation: boolean,
  difficulty: Difficulty
): {
  path: PathResult;
  colors: Map<string, ColorAssignment>;
  tileAssign: TileAssignmentResult;
} | null {
  const cfg = DIFFICULTY_CONFIGS[difficulty];
  const rngCopy = createSeededRandom(rng.getSeed() + attemptBase * 7919);
  const path = generatePathStructure({
    rng: rngCopy,
    gridWidth: cfg.gridWidth,
    gridHeight: cfg.gridHeight,
    maxTiles: cfg.maxTiles,
    desiredFinals: cfg.desiredFinals,
    desvioBudget: cfg.desvioBudget,
    intersectionProbability: cfg.intersectionProbability,
    turnProbability: cfg.turnProbability,
    minBranchLength: cfg.minBranchLength,
    allow4WayIntersection: cfg.allow4WayIntersection,
  });

  if (path.endCoords.length < Math.max(1, cfg.desiredFinals - 1)) return null;
  if (path.endCoords.length > cfg.desiredFinals + 1) return null;
  if (path.grid.size < cfg.minTiles) return null;
  if (path.grid.size > cfg.maxTiles) return null;

  const colorOffset = rng.range(0, 3);
  const colors = assignColorsToPath(path, colorOffset);
  const tileRng = createSeededRandom(rng.getSeed() + attemptBase * 104729 + 13);
  const tileAssign = assignTilesToPath(path, colors, tileRng, {
    relaxSeparation,
    allowedCategories: cfg.allowedCategories,
    only1StarPuntos: cfg.only1StarPuntos,
    puntosDensity: cfg.puntosDensity,
    allow4WayIntersection: cfg.allow4WayIntersection,
    minCajaMagica: cfg.minCajaMagica,
    maxCajaMagica: cfg.maxCajaMagica,
    maxTragaMonedas: cfg.maxTragaMonedas,
    desiredFinals: cfg.desiredFinals,
    minBranchLength: cfg.minBranchLength,
  });
  return { path, colors, tileAssign };
}

export function generateBoard(inputSeed?: Seed | string, difficulty: Difficulty = 'tranquila'): BoardResult {
  const seed: Seed = inputSeed != null ? parseSeed(inputSeed) : generateRandomSeed();
  const cfg = DIFFICULTY_CONFIGS[difficulty];

  let relaxed = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createSeededRandom(seed + attempt * 31);
    const tryRelax = relaxed && attempt > MAX_ATTEMPTS * 0.6;
    const result = tryOnce(rng, attempt, tryRelax, difficulty);
    if (!result) continue;

    const { path, colors, tileAssign } = result;

    const colorPatternErrors = validateColorPattern(
      tileAssign.tiles,
      path,
      colors
    );
    const intersectionErrors = validateIntersectionContinuity(tileAssign.tiles);
    const validation = validateBoard(
      tileAssign.tiles,
      path,
      colors,
      tileAssign.usage,
      {
        desiredFinals: cfg.desiredFinals,
        minFinalLength: cfg.minBranchLength,
        minCajaMagica: cfg.minCajaMagica,
        maxCajaMagica: cfg.maxCajaMagica,
        maxTragaMonedas: cfg.maxTragaMonedas,
      }
    );

    const allErrors = [
      ...validation.errors,
      ...colorPatternErrors,
      ...intersectionErrors,
      ...tileAssign.errors,
    ];

    if (allErrors.length === 0) {
      return {
        tiles: tileAssign.tiles,
        pathResult: path,
        colorAssignments: colors,
        usage: tileAssign.usage,
        validation: {
          ...validation,
          errors: [],
          warnings: [
            ...validation.warnings,
            ...tileAssign.errors,
          ],
        },
        seed,
        attempts: attempt + 1,
        width: path.width,
        height: path.height,
        relaxedSeparation: tryRelax,
      };
    }

    if (attempt === MAX_ATTEMPTS - 1 && !relaxed) {
      console.warn(
        `[generateBoard] Intentos ${attempt + 1} sin relajar. Errores últimos 3:`,
        allErrors.slice(0, 10)
      );
    }
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createSeededRandom(seed + 99991 + attempt * 37);
    const result = tryOnce(rng, MAX_ATTEMPTS + attempt, true, difficulty);
    if (!result) continue;
    const { path, colors, tileAssign } = result;

    const colorPatternErrors = validateColorPattern(
      tileAssign.tiles,
      path,
      colors
    );
    const validation = validateBoard(
      tileAssign.tiles,
      path,
      colors,
      tileAssign.usage,
      {
        relaxedFinalLength: true,
        desiredFinals: cfg.desiredFinals,
        minFinalLength: cfg.minBranchLength,
        minCajaMagica: cfg.minCajaMagica,
        maxCajaMagica: cfg.maxCajaMagica,
        maxTragaMonedas: cfg.maxTragaMonedas,
      }
    );

    const hardErrors = [
      ...validation.errors.filter(
        (e) =>
          !e.includes('piezas idénticas consecutivas') &&
          !e.includes('separación') &&
          !e.includes('longitudes de ruta diferentes') &&
          !e.includes('distancia de pareja') &&
          !e.includes('pareja incompleta')
      ),
      ...colorPatternErrors.filter(
        (e) =>
          !e.includes('idénticas consecutivas') &&
          !e.includes('SUBTIPO spring consecutivas')
      ),
    ];

    if (hardErrors.length === 0) {
      console.log(
        `[generateBoard] Mapa generado con separación relajada (seed=${seed})`
      );
      return {
        tiles: tileAssign.tiles,
        pathResult: path,
        colorAssignments: colors,
        usage: tileAssign.usage,
        validation,
        seed,
        attempts: MAX_ATTEMPTS + attempt + 1,
        width: path.width,
        height: path.height,
        relaxedSeparation: true,
      };
    }

    if (attempt === MAX_ATTEMPTS - 1) {
      console.error(
        `[generateBoard] Fallaron ${MAX_ATTEMPTS * 2} intentos. Últimos errores:`,
        hardErrors
      );
    }
  }

  // --- FALLBACK FINAL CON HARD CHECKS ---
  // Cuando se acaban los 200 intentos (100 strict + 100 relaxed), NO DEVOLVEMOS
  // un mapa cualquiera (anterior bug: caía aquí y devolvía mapas con 0 finales, hojas muertas,
  // islas y trayectos sin finalizar). Ahora iteramos 100 intentos extra y exigimos HARD CHECKS:
  //   1. Start tiene exactamente 1 conector
  //   2. 0 hojas muertas (1-conector que no sea start ni final)
  //   3. Finals count ∈ [desiredFinals-1 .. desiredFinals+1]
  //   4. 0 islas DESCONECTADAS
  // Si aún así no encuentra, devolvemos el "mejor" candidato (menos hard errors).
  function extractHardErrors(
    validation: ValidationResult,
    tilesMap: Map<string, PlacedTile>
  ): string[] {
    const hard: string[] = [];
    for (const e of validation.errors) {
      if (
        e.includes('Ramas muertas SIN FINAL') ||
        e.includes('Piezas DESCONECTADAS del Inicio') ||
        e.includes('Camino muerto en') ||
        e.includes('Hay piezas desconectadas') ||
        e.includes('No existe camino válido desde Inicio a ningún Final') ||
        e.includes('start en') ||
        e.startsWith('Debe haber exactamente 1 Inicio') ||
        e.startsWith('Faltan Finales:') ||
        e.startsWith('Demasiados Finales:') ||
        e.startsWith('Máximo 4 Finales') ||
        e.includes('Final en (') ||
        e.includes('Conexión abierta inválida') ||
        e.includes('Conexión no recíproca')
      ) {
        hard.push(e);
      }
    }
    // Extra hard check directo sobre el tilesMap por si acaso
    const startTile = Array.from(tilesMap.values()).find(t => t.category === 'inicio');
    if (startTile && startTile.connectors.length !== 1) {
      hard.push(`start direct-check connectors=${startTile.connectors.length}`);
    }
    const hojasMuertas = Array.from(tilesMap.values()).filter(t =>
      t.connectors.length === 1 && t.category !== 'inicio' && t.category !== 'final'
    ).length;
    if (hojasMuertas > 0) hard.push(`hojas muertas direct-check = ${hojasMuertas}`);
    return hard;
  }

  type Candidate = {
    tiles: Map<string, PlacedTile>;
    pathResult: PathResult;
    colorAssignments: Map<string, ColorAssignment>;
    usage: Record<TileCategory, number>;
    validation: ValidationResult;
    hardCount: number;
    attemptsOffset: number;
    relaxedSeparation: boolean;
  };
  const candidates: Candidate[] = [];
  const EXTRA_FALLBACK_ATTEMPTS = 100;
  for (let attempt = 0; attempt < EXTRA_FALLBACK_ATTEMPTS; attempt++) {
    const rng = createSeededRandom(seed + 777777 + attempt * 53);
    const tryIt = tryOnce(rng, MAX_ATTEMPTS * 3 + attempt, true, difficulty);
    if (!tryIt) continue;
    const { path, colors, tileAssign } = tryIt;
    const val = validateBoard(tileAssign.tiles, path, colors, tileAssign.usage, {
      relaxedFinalLength: true,
      desiredFinals: cfg.desiredFinals,
      minFinalLength: cfg.minBranchLength,
      minCajaMagica: cfg.minCajaMagica,
      maxCajaMagica: cfg.maxCajaMagica,
      maxTragaMonedas: cfg.maxTragaMonedas,
    });
    const hard = extractHardErrors(val, tileAssign.tiles);
    const cand: Candidate = {
      tiles: tileAssign.tiles,
      pathResult: path,
      colorAssignments: colors,
      usage: tileAssign.usage,
      validation: val,
      hardCount: hard.length,
      attemptsOffset: attempt,
      relaxedSeparation: true,
    };
    if (hard.length === 0) {
      console.log(`[generateBoard] Fallback exitoso en intento ${attempt}: PASÓ hard checks.`);
      return {
        tiles: cand.tiles,
        pathResult: cand.pathResult,
        colorAssignments: cand.colorAssignments,
        usage: cand.usage,
        validation: cand.validation,
        seed,
        attempts: MAX_ATTEMPTS * 2 + 1 + attempt,
        width: cand.pathResult.width,
        height: cand.pathResult.height,
        relaxedSeparation: true,
      };
    }
    candidates.push(cand);
  }

  // Si ningún candidato pasó hard checks, devolvemos el MEJOR (menos hardCount)
  // Pero todavía intentamos no devolver mapas MUY rotos: si todos tienen >12 errores,
  // al menos es el mejor de ellos, para que la UI nunca se quede sin mapa.
  candidates.sort((a, b) => a.hardCount - b.hardCount);
  const best = candidates[0];
  if (best) {
    console.error(`[generateBoard] Todos los intentos fallaron (${MAX_ATTEMPTS * 2 + EXTRA_FALLBACK_ATTEMPTS}). Mejor candidato tiene ${best.hardCount} errores hard.`);
    return {
      tiles: best.tiles,
      pathResult: best.pathResult,
      colorAssignments: best.colorAssignments,
      usage: best.usage,
      validation: best.validation,
      seed,
      attempts: MAX_ATTEMPTS * 2 + 1 + EXTRA_FALLBACK_ATTEMPTS,
      width: best.pathResult.width,
      height: best.pathResult.height,
      relaxedSeparation: true,
    };
  }

  // Último último fallback si ni siquiera tryOnce devolvió algo
  // (debería ser imposible porque generatePath siempre genera algo)
  const lastRng = createSeededRandom(seed);
  const lastFb = generatePathStructure({
    rng: lastRng,
    gridWidth: cfg.gridWidth,
    gridHeight: cfg.gridHeight,
    maxTiles: cfg.maxTiles,
    desiredFinals: cfg.desiredFinals,
    desvioBudget: cfg.desvioBudget,
    intersectionProbability: cfg.intersectionProbability,
    turnProbability: cfg.turnProbability,
    minBranchLength: cfg.minBranchLength,
    allow4WayIntersection: cfg.allow4WayIntersection,
  });
  const lastColors = assignColorsToPath(lastFb, lastRng.range(0, 3));
  const lastTiles = assignTilesToPath(lastFb, lastColors, lastRng, {
    relaxSeparation: true,
    allowedCategories: cfg.allowedCategories,
    only1StarPuntos: cfg.only1StarPuntos,
    puntosDensity: cfg.puntosDensity,
    allow4WayIntersection: cfg.allow4WayIntersection,
    minCajaMagica: cfg.minCajaMagica,
    maxCajaMagica: cfg.maxCajaMagica,
    maxTragaMonedas: cfg.maxTragaMonedas,
    desiredFinals: cfg.desiredFinals,
    minBranchLength: cfg.minBranchLength,
  });
  const lastVal = validateBoard(lastTiles.tiles, lastFb, lastColors, lastTiles.usage, {
    relaxedFinalLength: true,
    desiredFinals: cfg.desiredFinals,
    minFinalLength: cfg.minBranchLength,
    minCajaMagica: cfg.minCajaMagica,
    maxCajaMagica: cfg.maxCajaMagica,
    maxTragaMonedas: cfg.maxTragaMonedas,
  });
  console.error('[generateBoard] Último fallback (sin candidatos).');
  return {
    tiles: lastTiles.tiles,
    pathResult: lastFb,
    colorAssignments: lastColors,
    usage: lastTiles.usage,
    validation: lastVal,
    seed,
    attempts: MAX_ATTEMPTS * 2 + 1 + EXTRA_FALLBACK_ATTEMPTS + 1,
    width: lastFb.width,
    height: lastFb.height,
    relaxedSeparation: true,
  };
}
