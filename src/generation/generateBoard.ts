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
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  tranquila: {
    key: 'tranquila',
    gridWidth: 14,
    gridHeight: 14,
    minTiles: 31,
    maxTiles: 31,
    minBranchLength: 29,
    desiredFinals: 1,
    desvioBudget: 0,
    intersectionProbability: 0,
    turnProbability: 0.35,
    allowedCategories: ['normal', 'curve', 'inicio', 'final', 'puntos', 'avanzar', 'retroceder'],
    only1StarPuntos: true,
    puntosDensity: 0.14,
    allow4WayIntersection: false,
  },
  moderada: {
    key: 'moderada',
    gridWidth: 14,
    gridHeight: 14,
    minTiles: 25,
    maxTiles: 52,
    minBranchLength: 20,
    desiredFinals: 2,
    desvioBudget: 3,
    intersectionProbability: 0.25,
    turnProbability: 0.3,
    allowedCategories: ['normal', 'curve', 'inicio', 'final', 'puntos', 'avanzar', 'retroceder', 'desvio', 'carcel', 'cajaMagica', 'tragaMonedas'],
    only1StarPuntos: false,
    puntosDensity: 0.12,
    allow4WayIntersection: false,
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

  if (path.endCoords.length !== cfg.desiredFinals) return null;
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
  });
  return { path, colors, tileAssign };
}

export function generateBoard(inputSeed?: Seed | string, difficulty: Difficulty = 'tranquila'): BoardResult {
  const seed: Seed = inputSeed != null ? parseSeed(inputSeed) : generateRandomSeed();

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
      tileAssign.usage
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
        allErrors.slice(0, 6)
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
      { relaxedFinalLength: true }
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

  const cfg = DIFFICULTY_CONFIGS[difficulty];
  const rng = createSeededRandom(seed);
  const fallback = generatePathStructure({
    rng,
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
  const colors = assignColorsToPath(fallback, rng.range(0, 3));
  const tiles = assignTilesToPath(fallback, colors, rng, {
    relaxSeparation: true,
    allowedCategories: cfg.allowedCategories,
    only1StarPuntos: cfg.only1StarPuntos,
    puntosDensity: cfg.puntosDensity,
    allow4WayIntersection: cfg.allow4WayIntersection,
  });
  const validation = validateBoard(tiles.tiles, fallback, colors, tiles.usage, { relaxedFinalLength: true });
  return {
    tiles: tiles.tiles,
    pathResult: fallback,
    colorAssignments: colors,
    usage: tiles.usage,
    validation,
    seed,
    attempts: MAX_ATTEMPTS * 2 + 1,
    width: fallback.width,
    height: fallback.height,
    relaxedSeparation: true,
  };
}
