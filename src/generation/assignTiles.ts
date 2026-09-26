/**
 * Asignación de categorías de losetas (normal, curve, special, etc.)
 *
 * - Determina la geometría (straight, curve, intersection) según las conexiones.
 * - Decide en qué celdas colocar piezas especiales (separación mínima).
 * - Respeta inventario máximo.
 * - Evita piezas idénticas consecutivas.
 */
import type { Direction, TileShape, SpringSubtype, PortalFamily } from '../data/tiles';
import {
  OPPOSITE_DIR,
  DIR_DELTA,
  COLOR_CYCLE,
  createTileFromCategory,
  createStartTile,
  createEndTile,
  type PlacedTile,
  PORTAL_FAMILY_BY_KEY,
  PORTAL_PAIR_MEMBER,
} from '../data/tiles';
import {
  SPECIAL_CATEGORIES,
  MOVEMENT_CATEGORIES,
  TILE_INVENTORY,
  type TileCategory,
  type ColorName,
  inventoryCountFor,
} from '../data/tileInventory';
import type { PathResult } from './generatePath';
import type { ColorAssignment } from './assignColors';
import type { SeededRandom } from './seededRandom';
import type { TileColor } from '../data/assetMap';
import { runCleanupModerada } from './cleanupModerada';
import { preTransformI4ToI3 } from './preTransformI4';
import { findShortBranchCells } from './findShortBranches';
import {
  ensurePortalPairs,
  enforceFinalEndpoints,
  enforceStartNeighbor,
  balanceCajasAndTragamonedas,
  PORTAL_PAIRS,
} from './postAdjustTiles';

export interface TileAssignmentResult {
  tiles: Map<string, PlacedTile>;
  usage: Record<TileCategory, number>;
  errors: string[];
}

interface AssignOptions {
  relaxSeparation?: boolean;
  allowedCategories?: TileCategory[];
  only1StarPuntos?: boolean;
  puntosDensity?: number;
  allow4WayIntersection?: boolean;
  minCajaMagica?: number;
  maxCajaMagica?: number;
  maxTragaMonedas?: number;
  desiredFinals?: number;
  minBranchLength?: number;
}

export { PORTAL_PAIRS };

export const SPRING_SUBTYPE_INFO: Record<SpringSubtype, {
  category: TileCategory;
  amount: 2 | 4;
  pairDistance: number;
  allowedColors: ColorName[];
  maxCount: number;
}> = {
  derecha2:   { category: 'avanzar',    amount: 2, pairDistance: 2, allowedColors: ['rojo', 'rosado'],    maxCount: 2 },
  derecha4:   { category: 'avanzar',    amount: 4, pairDistance: 4, allowedColors: ['amarillo', 'azul'],  maxCount: 2 },
  izquierda2: { category: 'retroceder', amount: 2, pairDistance: 2, allowedColors: ['rojo', 'rosado'],    maxCount: 2 },
  izquierda4: { category: 'retroceder', amount: 4, pairDistance: 4, allowedColors: ['amarillo', 'azul'],  maxCount: 2 },
};

const ALL_SPRING_SUBTYPES: SpringSubtype[] = ['derecha2', 'derecha4', 'izquierda2', 'izquierda4'];

function getValidSpringSubtypes(
  currentStep: number,
  subtypeUsage: Record<SpringSubtype, number>,
  subtypeSteps: Record<SpringSubtype, number[]>,
  allowedCategories: TileCategory[]
): SpringSubtype[] {
  const allowedSet = new Set(allowedCategories);
  const result: SpringSubtype[] = [];
  for (const s of ALL_SPRING_SUBTYPES) {
    const info = SPRING_SUBTYPE_INFO[s];
    if (!allowedSet.has(info.category)) continue;
    const usage = subtypeUsage[s] ?? 0;
    if (usage >= info.maxCount) continue;
    if (usage === 0) {
      result.push(s);
      continue;
    }
    const lastStep = subtypeSteps[s][subtypeSteps[s].length - 1];
    if (currentStep - lastStep === info.pairDistance) {
      result.push(s);
    }
  }
  return result;
}

function classifyShape(cell: {
  incoming: Direction | null;
  outgoing: Direction[];
  numConnectors: number;
  isStart: boolean;
  isEnd: boolean;
}): TileShape {
  if (cell.isStart) return 'start';
  if (cell.isEnd) return 'end';
  const totalConn = cell.numConnectors;
  if (totalConn === 4) return 'intersection4';
  if (totalConn === 3) return 'intersection3';
  if (totalConn === 2) {
    const dirs: Direction[] = [];
    if (cell.incoming) dirs.push(cell.incoming);
    for (const d of cell.outgoing) dirs.push(d);
    if (dirs.length === 2) {
      const [a, b] = dirs;
      if (OPPOSITE_DIR[a] === b) return 'straight';
      return 'curve';
    }
  }
  if (cell.incoming && cell.outgoing.length === 1) {
    const out = cell.outgoing[0];
    const opp = OPPOSITE_DIR[cell.incoming];
    const res = out === opp ? 'straight' : 'curve';
    return res;
  }
  if (cell.outgoing.length === 2) {
    const d1 = cell.outgoing[0];
    const d2 = cell.outgoing[1];
    const idx1 = ['north', 'east', 'south', 'west'].indexOf(d1);
    const idx2 = ['north', 'east', 'south', 'west'].indexOf(d2);
    const diff = Math.abs(idx1 - idx2);
    return diff === 2 ? 'straight' : 'curve';
  }
  return 'straight';
}

function getSpecialCategoryPool(
  movementBudget: number,
  remainingUsage: Record<TileCategory, number>,
  canIncludeMovement: boolean,
  allowedCategories: TileCategory[],
  validSpringSubtypes: SpringSubtype[]
): TileCategory[] {
  const allowedSet = new Set(allowedCategories);
  const validSpringCats = new Set(validSpringSubtypes.map(s => SPRING_SUBTYPE_INFO[s].category));
  const pool: TileCategory[] = [];
  for (const cat of SPECIAL_CATEGORIES) {
    if (!allowedSet.has(cat)) continue;
    if (cat === 'desvio') continue;
    if (MOVEMENT_CATEGORIES.includes(cat) && !canIncludeMovement) continue;
    if (MOVEMENT_CATEGORIES.includes(cat) && movementBudget <= 0) continue;
    if (MOVEMENT_CATEGORIES.includes(cat) && !validSpringCats.has(cat)) continue;
    if (remainingUsage[cat] > 0) {
      pool.push(cat);
      if (
        cat === 'puntos' ||
        cat === 'carcel' ||
        cat === 'cajaMagica' ||
        cat === 'tragaMonedas' ||
        cat === 'portal' ||
        cat === 'avanzar' ||
        cat === 'retroceder'
      ) {
        pool.push(cat);
        if (cat === 'cajaMagica' || cat === 'portal') pool.push(cat);
      }
    }
  }
  return pool;
}

export function assignTilesToPath(
  pathResult: PathResult,
  colorAssignments: Map<string, ColorAssignment>,
  rng: SeededRandom,
  options: AssignOptions = {}
): TileAssignmentResult {
  const {
    allowedCategories = ['normal', 'curve', 'inicio', 'final', 'puntos', 'carcel', 'desvio', 'avanzar', 'retroceder', 'portal', 'cajaMagica', 'tragaMonedas'] as TileCategory[],
    only1StarPuntos = false,
    puntosDensity = 0.15,
    allow4WayIntersection = false,
  } = options;
  let relaxSeparation = options.relaxSeparation ?? false;
  const allowedSet = new Set(allowedCategories);
  const { grid, startCoord, endCoords, stepToCoord } = pathResult;

  const tiles = new Map<string, PlacedTile>();
  const errors: string[] = [];
  const usage: Record<TileCategory, number> = {
    normal: 0,
    curve: 0,
    carcel: 0,
    puntos: 0,
    desvio: 0,
    avanzar: 0,
    retroceder: 0,
    portal: 0,
    cajaMagica: 0,
    tragaMonedas: 0,
    inicio: 0,
    final: 0,
  };
  const COLOR_KEYS: ColorName[] = ['rojo', 'rosado', 'amarillo', 'azul'];
  const colorUsage: Record<TileCategory, Record<ColorName, number>> = {
    normal: { rojo:0, rosado:0, amarillo:0, azul:0 },
    curve:  { rojo:0, rosado:0, amarillo:0, azul:0 },
    carcel: { rojo:0, rosado:0, amarillo:0, azul:0 },
    puntos: { rojo:0, rosado:0, amarillo:0, azul:0 },
    desvio: { rojo:0, rosado:0, amarillo:0, azul:0 },
    avanzar:{ rojo:0, rosado:0, amarillo:0, azul:0 },
    retroceder: { rojo:0, rosado:0, amarillo:0, azul:0 },
    portal: { rojo:0, rosado:0, amarillo:0, azul:0 },
    cajaMagica: { rojo:0, rosado:0, amarillo:0, azul:0 },
    tragaMonedas: { rojo:0, rosado:0, amarillo:0, azul:0 },
    inicio: { rojo:0, rosado:0, amarillo:0, azul:0 },
    final:  { rojo:0, rosado:0, amarillo:0, azul:0 },
  };
  const springSubtypeUsage: Record<SpringSubtype, number> = {
    derecha2: 0, derecha4: 0, izquierda2: 0, izquierda4: 0,
  };
  const springSubtypeSteps: Record<SpringSubtype, number[]> = {
    derecha2: [], derecha4: [], izquierda2: [], izquierda4: [],
  };
  let lastPickedSpringSubtype: SpringSubtype | null = null;
  let pendingPortalFamily: PortalFamily | null = null;
  let pendingPortalPlacementTries = 0;

  const desv3Max = TILE_INVENTORY.desvio.sub?.desv3 ?? 0;
  const desv4Max = TILE_INVENTORY.desvio.sub?.desv4 ?? 0;
  let desv3Used = 0;
  let desv4Used = 0;

  // Pre-cleanup modular: si !allow4WayIntersection, transformar I4 a I3
  preTransformI4ToI3(grid, startCoord, allow4WayIntersection);

  const PORTAL_MIN_FINAL_MANHATTAN = 7;
  const PORTAL_MIN_SEP_STEPS = 6;
  const portalUsageByFamily: Record<PortalFamily, { steps: number[]; coords: { x: number; y: number }[]; usedKeys: Set<string> }> = {
    blanco: { steps: [], coords: [], usedKeys: new Set() },
    azul:   { steps: [], coords: [], usedKeys: new Set() },
  };
  function isPortalFamilyComplete(fam: PortalFamily): boolean {
    return portalUsageByFamily[fam].usedKeys.size >= 2;
  }
  function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  function isPortalPlaceable(
    fam: PortalFamily,
    cell: { x: number; y: number; pathStep: number },
    theEndCoords: { x: number; y: number }[]
  ): boolean {
    const famData = portalUsageByFamily[fam];
    if (famData.usedKeys.size >= 2) return false;
    const otherFam: PortalFamily = fam === 'blanco' ? 'azul' : 'blanco';
    const otherFamData = portalUsageByFamily[otherFam];
    if (theEndCoords.some(ec => manhattan(cell, ec) < PORTAL_MIN_FINAL_MANHATTAN)) return false;
    if (famData.usedKeys.size === 1) {
      const lastStep = famData.steps[famData.steps.length - 1];
      if (Math.abs(cell.pathStep - lastStep) < 2) return false;
    }
    if (otherFamData.steps.length > 0) {
      const minOtherStep = Math.min(...otherFamData.steps);
      const maxOtherStep = Math.max(...otherFamData.steps);
      if (Math.max(
        Math.abs(cell.pathStep - minOtherStep),
        Math.abs(cell.pathStep - maxOtherStep),
      ) < PORTAL_MIN_SEP_STEPS && otherFamData.usedKeys.size >= 1) return false;
      if (Math.abs(cell.pathStep - otherFamData.steps[otherFamData.steps.length - 1]) < PORTAL_MIN_SEP_STEPS && otherFamData.usedKeys.size >= 2) return false;
    }
    return true;
  }
  function pickNextPortalKeyForFamily(fam: PortalFamily): string | null {
    const pair = PORTAL_PAIR_MEMBER[fam];
    for (const k of pair) if (!portalUsageByFamily[fam].usedKeys.has(k)) return k;
    return null;
  }

  function remaining(cat: TileCategory): number {
    if (cat === 'desvio') {
      const r3 = Math.max(0, desv3Max - desv3Used);
      const r4 = allow4WayIntersection ? Math.max(0, desv4Max - desv4Used) : 0;
      return r3 + r4;
    }
    return inventoryCountFor(cat) - usage[cat];
  }
  function remainingColor(cat: TileCategory, color: ColorName): number {
    const inv = TILE_INVENTORY[cat];
    const maxColor = inv.perColor[color] ?? 0;
    return maxColor - colorUsage[cat][color];
  }
  function incrementColorUsage(cat: TileCategory, color: ColorName | 'neutral') {
    if (color === 'neutral') return;
    if (COLOR_KEYS.includes(color as ColorName)) {
      colorUsage[cat][color as ColorName]++;
    }
  }
  function hasAnyColorRemainingFor(cat: TileCategory): boolean {
    const inv = TILE_INVENTORY[cat];
    for (const c of COLOR_KEYS) {
      if ((inv.perColor[c] ?? 0) - colorUsage[cat][c] > 0) return true;
    }
    return false;
  }
  const CYCLE_COLOR_LOCK_CATS: TileCategory[] = ['carcel', 'cajaMagica', 'tragaMonedas'];
  function isColorLockedForCycle(cat: TileCategory, color: ColorName, fallbackStep: number): boolean {
    if (!CYCLE_COLOR_LOCK_CATS.includes(cat)) return false;
    const currentCycle = Math.floor(fallbackStep / 4);
    for (const p of placedSequence) {
      if (p.cat !== cat || p.color !== color) continue;
      const pCycle = Math.floor(p.step / 4);
      if (Math.abs(pCycle - currentCycle) <= 1) return true;
      if (Math.abs(p.step - fallbackStep) < 5) return true;
    }
    return false;
  }
  function pickAvailableColorFor(cat: TileCategory, preferred: TileColor, fallbackStep: number, _rng: SeededRandom): TileColor | null {
    // REGLA DURA: el color de la loseta (si es con color) DEBE coincidir con el color del
    // patrón cromático del paso. No se permite inventario de otro color como fallback.
    const expected = COLOR_CYCLE[fallbackStep % 4] as ColorName;
    if (COLOR_KEYS.includes(expected) &&
        remainingColor(cat, expected) > 0 &&
        !isColorLockedForCycle(cat, expected, fallbackStep)) {
      return expected;
    }
    if (preferred && preferred !== 'neutral' && preferred === expected) {
      if (COLOR_KEYS.includes(preferred as ColorName) &&
          remainingColor(cat, preferred as ColorName) > 0 &&
          !isColorLockedForCycle(cat, preferred as ColorName, fallbackStep)) {
        return preferred;
      }
    }
    // Si no hay disponible el color exacto que toca en el patrón: esta categoría
    // NO se puede colocar aquí. El caller debe degradar categoría (normal/curve/2Estrellas).
    return null;
  }
  function pickColorForSpringSubtype(
    subtype: SpringSubtype,
    _preferred: TileColor,
    fallbackStep: number,
    _rng: SeededRandom
  ): TileColor | null {
    // REGLA DURA: el spring tiene que coincidir con el COLOR del PASO (patrón cromático)
    // y además estar permitido para ese subtype (derecha2: rojo/rosado; derecha4: amarillo/azul).
    // Si el color del paso no se permite para este subtype, este subtype NO SE PUEDE USAR.
    const info = SPRING_SUBTYPE_INFO[subtype];
    const expected = COLOR_CYCLE[fallbackStep % 4] as ColorName;
    if (!info.allowedColors.includes(expected)) return null;
    if (remainingColor(info.category, expected) <= 0) return null;
    return expected;
  }
  function pickSpringSubtypeForCategory(
    category: TileCategory,
    validSubtypes: SpringSubtype[],
    rng: SeededRandom
  ): SpringSubtype | null {
    const matching = validSubtypes.filter(s => SPRING_SUBTYPE_INFO[s].category === category);
    if (matching.length === 0) return null;
    const priorityPending = matching.filter(s => (springSubtypeUsage[s] ?? 0) === 1);
    if (priorityPending.length > 0) {
      return rng.pick(priorityPending);
    }
    const priorityFresh = matching.filter(s => (springSubtypeUsage[s] ?? 0) === 0);
    if (priorityFresh.length > 0) {
      return rng.pick(priorityFresh);
    }
    return rng.pick(matching);
  }

  const startKey = `${startCoord.x},${startCoord.y}`;
  const startCell = grid.get(startKey);
  if (startCell) {
    const startDir = startCell.outgoing[0] ?? 'east';
    const tile: PlacedTile = {
      ...createStartTile(startDir),
      x: startCoord.x,
      y: startCoord.y,
      pathStep: 0,
      branchId: 0,
      parentStep: null,
    };
    tiles.set(startKey, tile);
    usage.inicio++;
  }

  for (const ec of endCoords) {
    const key = `${ec.x},${ec.y}`;
    const cell = grid.get(key);
    if (cell && !tiles.has(key)) {
      const incoming = cell.incoming ?? 'west';
      const tile: PlacedTile = {
        ...createEndTile(incoming),
        x: ec.x,
        y: ec.y,
        pathStep: cell.pathStep,
        branchId: cell.branchId,
        parentStep: cell.parentStep,
      };
      tiles.set(key, tile);
      usage.final++;
    }
  }

  const allCells = Array.from(grid.values()).filter(
    (c) => !c.isStart && !c.isEnd
  );
  allCells.sort((a, b) => a.pathStep - b.pathStep);

  // Detección modular de rama más corta para penalizaciones (Cárcel / Tragamonedas / Retroceder)
  const shortBranchSet = findShortBranchCells(grid, startCoord, endCoords);

  let movementCooldown = 0;
  let specialCount = 0;
  let movementCount = 0;
  const placedSequence: { key: string; cat: TileCategory; color: TileColor; step: number }[] = [];
  // NUEVA REGLA (usuario 2026-09-22): la separación de especiales es SÓLO entre ESPECIALES DEL MISMO TIPO.
  // Diferentes categorías pueden ser consecutivas (ej. puntos + cajaMagica OK; puntos + puntos NO).
  const cooldownByCategory: Record<string, number> = {};
  const minSameCategoryGap = relaxSeparation ? 1 : 2;
  const minMovementGap = relaxSeparation ? 2 : 4;

  for (const cell of allCells) {
    const key = `${cell.x},${cell.y}`;
    if (tiles.has(key)) continue;

    // SKIP SIEMPRE: celdas sin al menos 2 conectores (start/end ya procesados).
    // Evita los "cuadrados sueltos" de color sin loseta SVG.
    if (cell.numConnectors < 2) continue;

    lastPickedSpringSubtype = null;

    const shape = classifyShape(cell);
    const colorAssign = colorAssignments.get(key);

    const requiredConnectors: Direction[] = [];
    if (cell.incoming) requiredConnectors.push(cell.incoming);
    for (const od of cell.outgoing) requiredConnectors.push(od);

    // Garantía: requiredConnectors sin duplicados y longitud === numConnectors
    const uniqueReq = Array.from(new Set(requiredConnectors));
    if (uniqueReq.length < 2) continue;

    let category: TileCategory = 'normal';
    const needsCurve = shape === 'curve';
    let chosenPortalFamily: PortalFamily | null = null;
    const isIntersection =
      shape === 'intersection3' || shape === 'intersection4';

    // REGLA DURA: Si la celda tiene 3/4 vecinos (shape=intersection3/4) Y
    // Moderada/Loca no permiten desvío / no quedan en inventario → SKIP celda.
    // NUNCA forzamos categorías que rompan la estructura de la intersección.
    if (isIntersection) {
      if (!allowedSet.has('desvio')) { continue; }
      if (shape === 'intersection3') {
        if (desv3Used >= desv3Max) { continue; }
      } else if (shape === 'intersection4') {
        if (!allow4WayIntersection) { continue; }
        if (desv4Used >= desv4Max) { continue; }
      }
    }
    const currentValidSprings = getValidSpringSubtypes(
      cell.pathStep,
      springSubtypeUsage,
      springSubtypeSteps,
      allowedCategories
    );

    if (isIntersection) {
      category = 'desvio';
    } else if (needsCurve) {
      category = 'curve';
      if (!allowedSet.has('curve') || remaining('curve') <= 0) {
        if (!relaxSeparation) {
          relaxSeparation = true;
        }
      }
    } else {
      let isSpecial = false;
      let forcePortalFamily: PortalFamily | null = null;
      chosenPortalFamily = null;
      if (pendingPortalFamily && !needsCurve) {
        if (isPortalPlaceable(pendingPortalFamily, cell, endCoords)) {
          forcePortalFamily = pendingPortalFamily;
        } else {
          pendingPortalPlacementTries++;
          if (pendingPortalPlacementTries >= 6) {
            pendingPortalFamily = null;
            pendingPortalPlacementTries = 0;
          }
        }
      }
      const pendingPairSubtypes = currentValidSprings.filter(s => (springSubtypeUsage[s] ?? 0) === 1);
      const forcePendingPair: SpringSubtype | null =
        pendingPairSubtypes.length > 0 && movementCooldown <= 0 && !needsCurve
          ? pendingPairSubtypes[0]
          : null;

      const totalLeft =
        allCells.length -
        allCells.findIndex((c) => c.pathStep === cell.pathStep);
      const specialProb =
        relaxSeparation && specialCount < 20
          ? Math.max(puntosDensity, 0.35)
          : specialCount < 14
          ? Math.max(puntosDensity, 0.32)
          : totalLeft > 20
          ? Math.max(puntosDensity, 0.25)
          : Math.max(0.12, puntosDensity * 0.75);

      if (forcePortalFamily || forcePendingPair || rng.chance(specialProb)) {
          const canMove = movementCooldown <= 0 || !!forcePendingPair;
          const availableFamilies: PortalFamily[] = (['blanco', 'azul'] as PortalFamily[]).filter(f =>
            allowedSet.has('portal') &&
            remaining('portal') > (pendingPortalFamily ? 0 : 1) &&
            !isPortalFamilyComplete(f) &&
            (forcePortalFamily === f || isPortalPlaceable(f, cell, endCoords)) &&
            // NUEVA REGLA: si ya se colocó un portal recientemente (mismo tipo) saltar
            ((cooldownByCategory['portal'] ?? 0) <= 0 || forcePortalFamily === f)
          );

          if (forcePortalFamily && availableFamilies.includes(forcePortalFamily)) {
            category = 'portal';
            chosenPortalFamily = forcePortalFamily;
            isSpecial = true;
            specialCount++;
            cooldownByCategory['portal'] = minSameCategoryGap;
          } else if (forcePendingPair && remaining(SPRING_SUBTYPE_INFO[forcePendingPair].category) > 0) {
            const pool = getSpecialCategoryPool(
              8 - movementCount,
              {
                normal: remaining('normal'),
                curve: remaining('curve'),
                carcel: remaining('carcel'),
                puntos: remaining('puntos'),
                desvio: remaining('desvio'),
                avanzar: remaining('avanzar'),
                retroceder: remaining('retroceder'),
                portal: remaining('portal'),
                cajaMagica: remaining('cajaMagica'),
                tragaMonedas: remaining('tragaMonedas'),
                inicio: remaining('inicio'),
                final: remaining('final'),
              },
              canMove,
              allowedCategories,
              currentValidSprings
            );
            if (pool.length > 0) {
              const pick = SPRING_SUBTYPE_INFO[forcePendingPair].category;
              const selectedSub = forcePendingPair;
              lastPickedSpringSubtype = selectedSub;
              category = pick;
              isSpecial = true;
              specialCount++;
              movementCount++;
              movementCooldown = minMovementGap;
            }
          } else {
            const pool = getSpecialCategoryPool(
              8 - movementCount,
              {
                normal: remaining('normal'),
                curve: remaining('curve'),
                carcel: remaining('carcel'),
                puntos: remaining('puntos'),
                desvio: remaining('desvio'),
                avanzar: remaining('avanzar'),
                retroceder: remaining('retroceder'),
                portal: availableFamilies.length > 0 ? remaining('portal') : 0,
                cajaMagica: remaining('cajaMagica'),
                tragaMonedas: remaining('tragaMonedas'),
                inicio: remaining('inicio'),
                final: remaining('final'),
              },
              canMove,
              allowedCategories,
              currentValidSprings
            );
            if (pool.length > 0) {
              const pick = rng.pick(pool);
              // NUEVA REGLA usuario: salto de categoría sólo si es EL MISMO TIPO consecutivamente.
              const cooldownBlocked = (cooldownByCategory[pick] ?? 0) > 0;
              // No bloquear si son distinto color y distinto tipo; mismo tipo SIEMPRE bloquea por 2 pasos.
              const sameCatSameColorBlocked = placedSequence.length > 0 &&
                placedSequence[placedSequence.length - 1].cat === pick &&
                placedSequence[placedSequence.length - 1].color === (
                  colorAssign?.color && colorAssign.color !== 'neutral'
                    ? colorAssign.color
                    : COLOR_CYCLE[cell.pathStep % 4]
                );
              if ((!cooldownBlocked && !sameCatSameColorBlocked) || relaxSeparation) {
                if (pick === 'portal' && availableFamilies.length > 0) {
                  const fam = rng.pick(availableFamilies);
                  category = 'portal';
                  chosenPortalFamily = fam;
                  isSpecial = true;
                  specialCount++;
                  cooldownByCategory['portal'] = minSameCategoryGap;
                  if (!pendingPortalFamily) {
                    pendingPortalFamily = fam;
                    pendingPortalPlacementTries = 0;
                  }
                } else if (MOVEMENT_CATEGORIES.includes(pick)) {
                  const selectedSub = pickSpringSubtypeForCategory(pick, currentValidSprings, rng);
                  if (!selectedSub) {
                    if (allowedSet.has('normal') && remaining('normal') > 0) {
                      category = 'normal';
                      isSpecial = false;
                    } else if (allowedSet.has('curve') && remaining('curve') > 0) {
                      category = 'curve';
                      isSpecial = false;
                    }
                  } else {
                    lastPickedSpringSubtype = selectedSub;
                    category = pick;
                    isSpecial = true;
                    specialCount++;
                    movementCount++;
                    movementCooldown = minMovementGap;
                    cooldownByCategory[pick] = minSameCategoryGap;
                  }
                } else {
                  category = pick;
                  isSpecial = true;
                  specialCount++;
                  cooldownByCategory[pick] = minSameCategoryGap;
                }
              }
            }
          }
        }

      if (!isSpecial) {
        if (allowedSet.has('normal') && remaining('normal') > 0) {
          category = 'normal';
        } else if (allowedSet.has('curve') && remaining('curve') > 0) {
          category = 'curve';
        } else {
          const fallback: TileCategory | undefined = SPECIAL_CATEGORIES.filter(
            (c) => c !== 'desvio' && allowedSet.has(c) && remaining(c) > 0 && (
              !MOVEMENT_CATEGORIES.includes(c) || currentValidSprings.some(s => SPRING_SUBTYPE_INFO[s].category === c)
            )
          )[0];
          category = fallback ?? (allowedSet.has('normal') ? 'normal' : 'curve');
          if (MOVEMENT_CATEGORIES.includes(category)) {
            const sel = pickSpringSubtypeForCategory(category, currentValidSprings, rng);
            if (sel) lastPickedSpringSubtype = sel;
          }
        }
      }
    }

    const assignedColor =
      colorAssign?.color && colorAssign.color !== 'neutral'
        ? colorAssign.color
        : (COLOR_CYCLE[cell.pathStep % 4] as TileColor);

    let willBe2Estrellas = false;
    if (category === 'puntos' && !only1StarPuntos && specialCount >= 3 && specialCount % 4 === 3) {
      willBe2Estrellas = true;
    }
    void 0;

    // Helper local: intenta pickAvailableColorFor. Si retorna null, degrada categoría
    // en orden (normal → curve → puntos 1★) hasta encontrar una CON COLOR DISPONIBLE.
    // (Este helper NO cambia willBe2Estrellas; 2Estrellas neutral se maneja más adelante).
    const resolveColor = (initialCat: TileCategory): { cat: TileCategory; color: TileColor; usedSpring: SpringSubtype | null } => {
      const cat = initialCat;
      if (cat === 'desvio' || cat === 'inicio' || cat === 'final') {
        return { cat, color: 'neutral', usedSpring: null };
      }
      if ((cat === 'avanzar' || cat === 'retroceder') && lastPickedSpringSubtype) {
        const sc = pickColorForSpringSubtype(lastPickedSpringSubtype, assignedColor, cell.pathStep, rng);
        if (sc) return { cat, color: sc, usedSpring: lastPickedSpringSubtype };
      }
      if (cat === 'puntos' && willBe2Estrellas) {
        return { cat, color: 'neutral', usedSpring: null };
      }
      const c = pickAvailableColorFor(cat, assignedColor, cell.pathStep, rng);
      if (c) return { cat, color: c, usedSpring: null };

      // Degradación en orden: la categoría degradada DEBE tener el color del paso.
      const fallbackOrderNeedsCurve: TileCategory[] = needsCurve
        ? ['curve', 'puntos', 'carcel', 'tragaMonedas', 'cajaMagica', 'portal', 'normal']
        : ['normal', 'curve', 'puntos', 'carcel', 'tragaMonedas', 'cajaMagica', 'portal'];
      for (const fb of fallbackOrderNeedsCurve) {
        if (!allowedSet.has(fb) || remaining(fb) <= 0) continue;
        if (fb === 'desvio' || fb === 'inicio' || fb === 'final') continue;
        const fbColor = pickAvailableColorFor(fb, assignedColor, cell.pathStep, rng);
        if (fbColor) {
          lastPickedSpringSubtype = null;
          return { cat: fb, color: fbColor, usedSpring: null };
        }
      }
      // Último recurso (no debería): color esperado del ciclo con categoría normal.
      return { cat: 'normal', color: COLOR_CYCLE[cell.pathStep % 4] as TileColor, usedSpring: null };
    };

    let resolved: { cat: TileCategory; color: TileColor; usedSpring: SpringSubtype | null };
    {
      // OVERRIDE RAMA CORTA (después de una intersección): PRIORIDAD MÁXIMA para
      // categorías PENALIZADORAS (Tragamonedas → Cárcel → Retroceder).
      // Solo se aplica si pertenece a shortBranchSet y todos los checks ok.
      let overrideOk = false;
      let oCat: TileCategory = category;
      let oColor: TileColor = assignedColor;
      let oSpring: SpringSubtype | null = null;
      if (shortBranchSet.has(key) && !cell.isIntersection) {
        const tryCats: TileCategory[] = ['tragaMonedas', 'carcel', 'retroceder'];
        for (const pc of tryCats) {
          if (!allowedSet.has(pc)) continue;
          if (remaining(pc) <= 0) continue;
          if ((cooldownByCategory[pc] ?? 0) > 0) continue;
          let pcColor: TileColor | null = null;
          let pcSpring: SpringSubtype | null = null;
          if (pc === 'retroceder') {
            const vs = getValidSpringSubtypes(cell.pathStep, springSubtypeUsage, springSubtypeSteps, allowedCategories);
            for (const sb of vs) {
              if (SPRING_SUBTYPE_INFO[sb].category !== 'retroceder') continue;
              const sc = pickColorForSpringSubtype(sb, assignedColor, cell.pathStep, rng);
              if (sc) { pcColor = sc; pcSpring = sb; break; }
            }
          } else if (pc === 'avanzar') {
            const vs = getValidSpringSubtypes(cell.pathStep, springSubtypeUsage, springSubtypeSteps, allowedCategories);
            for (const sb of vs) {
              if (SPRING_SUBTYPE_INFO[sb].category !== 'avanzar') continue;
              const sc = pickColorForSpringSubtype(sb, assignedColor, cell.pathStep, rng);
              if (sc) { pcColor = sc; pcSpring = sb; break; }
            }
          } else {
            pcColor = pickAvailableColorFor(pc, assignedColor, cell.pathStep, rng);
          }
          if (!pcColor) continue;
          oCat = pc; oColor = pcColor; oSpring = pcSpring;
          overrideOk = true;
          break;
        }
      }
      if (overrideOk) {
        resolved = { cat: oCat, color: oColor, usedSpring: oSpring };
        willBe2Estrellas = false;
      } else {
        resolved = resolveColor(category);
      }
    }
    category = resolved.cat;
    lastPickedSpringSubtype = resolved.usedSpring;
    let effectiveColor: TileColor = resolved.color;

    // Re-calcular neutralidad (por si categoría cambió a desvio/inicio/final o 2Estrellas)
    const newWillBe2Estrellas =
      category === 'puntos' && !only1StarPuntos && specialCount >= 3 && specialCount % 4 === 3;
    if (newWillBe2Estrellas) {
      effectiveColor = 'neutral';
    }
    const nowNeutral =
      category === 'desvio' || category === 'inicio' || category === 'final' ||
      (category === 'puntos' && newWillBe2Estrellas);
    if (nowNeutral) effectiveColor = 'neutral';
    willBe2Estrellas = newWillBe2Estrellas;

    // Check simple: si categoría no permitida o sin existencia, volver a resolver
    if (!allowedSet.has(category) || remaining(category) <= 0 ||
        (!nowNeutral && !pickAvailableColorFor(category, assignedColor, cell.pathStep, rng))) {
      const fbCandidates: TileCategory[] = needsCurve
        ? (['curve', 'puntos', 'carcel', 'tragaMonedas', 'cajaMagica', 'portal', 'normal'] as TileCategory[])
        : (['normal', 'curve', 'puntos', 'carcel', 'tragaMonedas', 'cajaMagica', 'portal', 'avanzar', 'retroceder', 'desvio'] as TileCategory[]);
      for (const c of fbCandidates) {
        if (!allowedSet.has(c) || remaining(c) <= 0) continue;
        if (c === 'desvio' || c === 'inicio' || c === 'final') continue;
        const col = pickAvailableColorFor(c, assignedColor, cell.pathStep, rng);
        if (col) {
          category = c;
          effectiveColor = col;
          lastPickedSpringSubtype = null;
          break;
        }
      }
    }

    const prevKey = cell.parentStep != null
      ? (() => {
          const p = stepToCoord.get(cell.parentStep);
          return p ? `${p.x},${p.y}` : null;
        })()
      : null;
    const prevTile = prevKey ? tiles.get(prevKey) : null;
    if (prevTile && prevTile.category === category && prevTile.color === effectiveColor) {
      const prevIsNormal = category === 'normal';
      // REGLA DURA: Si needsCurve, NUNCA cambiamos category='curve' por otra cosa
      // (sólo aceptar switch si NO es necesario el giro visualmente).
      const canSwitchCurve = !needsCurve && allowedSet.has('curve') && remaining('curve') > 0 &&
        !!pickAvailableColorFor('curve', assignedColor, cell.pathStep, rng);
      const canSwitchNormal = allowedSet.has('normal') && remaining('normal') > 0 &&
        !!pickAvailableColorFor('normal', assignedColor, cell.pathStep, rng);
      if (prevIsNormal && canSwitchCurve) {
        category = 'curve';
        lastPickedSpringSubtype = null;
        const col = pickAvailableColorFor('curve', assignedColor, cell.pathStep, rng);
        if (col) effectiveColor = col;
      } else if (category === 'curve' && canSwitchNormal && !needsCurve) {
        category = 'normal';
        lastPickedSpringSubtype = null;
        const col = pickAvailableColorFor('normal', assignedColor, cell.pathStep, rng);
        if (col) effectiveColor = col;
      } else if (SPECIAL_CATEGORIES.includes(category) && canSwitchNormal) {
        category = 'normal';
        lastPickedSpringSubtype = null;
        const col = pickAvailableColorFor('normal', assignedColor, cell.pathStep, rng);
        if (col) effectiveColor = col;
      } else if (SPECIAL_CATEGORIES.includes(category) && canSwitchCurve) {
        category = 'curve';
        lastPickedSpringSubtype = null;
        const col = pickAvailableColorFor('curve', assignedColor, cell.pathStep, rng);
        if (col) effectiveColor = col;
      }
    }

    if (MOVEMENT_CATEGORIES.includes(category) && nowNeutral) {
      if (allowedSet.has('normal') && remaining('normal') > 0 && pickAvailableColorFor('normal', assignedColor, cell.pathStep, rng)) {
        category = 'normal';
        effectiveColor = pickAvailableColorFor('normal', assignedColor, cell.pathStep, rng) ?? effectiveColor;
      } else if (allowedSet.has('curve') && remaining('curve') > 0 && pickAvailableColorFor('curve', assignedColor, cell.pathStep, rng)) {
        category = 'curve';
        effectiveColor = pickAvailableColorFor('curve', assignedColor, cell.pathStep, rng) ?? effectiveColor;
      } else {
        category = 'puntos';
        effectiveColor = 'neutral';
        willBe2Estrellas = !only1StarPuntos;
      }
      lastPickedSpringSubtype = null;
    }

    // REGLA DURA (cuotas hard sweep):
    // Si la categoría elegida supera maxCajaMagica / maxTragaMonedas, bajar a normal.
    // Evita que sweep coloque 4 tragamonedas cuando el máximo permitido es 1.
    if (category === 'cajaMagica' && typeof options.maxCajaMagica === 'number') {
      const currentC = usage.cajaMagica ?? 0;
      if (currentC >= options.maxCajaMagica) {
        category = allowedSet.has('normal') ? 'normal' : category;
        if (category === 'normal') {
          willBe2Estrellas = false;
        }
      }
    }
    if (category === 'tragaMonedas' && typeof options.maxTragaMonedas === 'number') {
      const currentT = usage.tragaMonedas ?? 0;
      if (currentT >= options.maxTragaMonedas) {
        category = allowedSet.has('normal') ? 'normal' : category;
        if (category === 'normal') {
          willBe2Estrellas = false;
        }
      }
    }

    // REGLA DURA:
    // - curve (cambio dirección) → SIEMPRE category='curve' (sin excepciones)
    // - intersection3/intersection4 → SOLO category='desvio'. NO fallback, NO degrade.
    //   (la loseta de intersección une 3/4 caminos y nada más).
    // - cajaMagica / tragaMonedas → SOLO en STRAIGHT (SVGs rectos, prohibida curva por solapamiento visual).
    let finalShapeForCategory: TileShape;
    let skipCell = false;
    if (shape === 'curve') {
      finalShapeForCategory = 'curve';
      if (category !== 'curve') {
        if (allowedSet.has('curve') && remaining('curve') > 0) {
          category = 'curve';
          lastPickedSpringSubtype = null;
          const col = pickAvailableColorFor('curve', assignedColor, cell.pathStep, rng);
          if (col) {
            effectiveColor = col;
          } else {
            // Sin color adecuado para la curva: no podemos colocar curva aquí.
            skipCell = true;
            errors.push(`Celda (${cell.x},${cell.y}) necesita CURVA pero sin color disponible (cromático bloqueado).`);
          }
        } else {
          skipCell = true;
          errors.push(`Celda (${cell.x},${cell.y}) necesita CURVA pero sin inventario.`);
        }
      }
    } else if (shape === 'intersection3' || shape === 'intersection4') {
      finalShapeForCategory = shape;
      if (category !== 'desvio' || !allowedSet.has('desvio') || remaining('desvio') <= 0) {
        if (allowedSet.has('desvio') && remaining('desvio') > 0) {
          category = 'desvio';
          effectiveColor = 'neutral';
          lastPickedSpringSubtype = null;
        } else {
          skipCell = true;
          errors.push(`Celda (${cell.x},${cell.y}) necesita DESVIO shape=${shape} pero sin presupuesto/inventario.`);
        }
      }
    } else if (needsCurve && (category === 'cajaMagica' || category === 'tragaMonedas')) {
      // Caso raro: lógica escogió cajaMagica/tragaMonedas pero clasificación interna es curve.
      // Bajar a curve/normal para no romper la geometría visual.
      category = allowedSet.has('curve') && remaining('curve') > 0 ? 'curve' : 'normal';
      lastPickedSpringSubtype = null;
      if (category === 'curve') {
        const col = pickAvailableColorFor('curve', assignedColor, cell.pathStep, rng);
        if (col) effectiveColor = col;
      }
      finalShapeForCategory = category === 'curve' ? 'curve' : 'straight';
    } else if (category === 'puntos' && willBe2Estrellas) {
      finalShapeForCategory = 'straight';
    } else {
      finalShapeForCategory = category === 'curve' ? 'curve' : 'straight';
    }
    if (skipCell) continue;

    let tileMeta = createTileFromCategory(
      category,
      effectiveColor,
      finalShapeForCategory,
      requiredConnectors,
      specialCount,
      only1StarPuntos
    );

    if (!tileMeta && !(shape === 'intersection3' || shape === 'intersection4')) {
      // REGLA DURA: NUNCA probamos shapes alternativos que rompan la geometría.
      // - Si classifyShape=curve → SOLO probamos ['curve'] (sin straight fallback).
      // - Si classifyShape=straight → SOLO probamos ['straight'] (sin curve fallback).
      // Si no encaja → no se coloca aquí; preferimos un tablero más pequeño.
      const tryShapes: TileShape[] = needsCurve ? ['curve'] : ['straight'];
      for (const s of tryShapes) {
        if (s === finalShapeForCategory) continue;
        tileMeta = createTileFromCategory(category, effectiveColor, s, requiredConnectors, specialCount, only1StarPuntos);
        if (tileMeta) break;
      }
    }
    if (!tileMeta && !(shape === 'intersection3' || shape === 'intersection4')) {
      // REGLA DURA IGUAL para categorías alternativas: NO cambiar curve↔straight.
      // ADEMÁS: en cells CURVA, no usar cajaMagica/tragaMonedas (son SVGs rectos → solapamiento).
      // ADEMÁS: respetar maxCajaMagica/maxTragaMonedas si están definidos.
      const allAltCats: TileCategory[] = (['normal', 'curve', 'puntos', 'carcel', 'tragaMonedas', 'cajaMagica', 'portal'] as TileCategory[]);
      const altCats = allAltCats.filter(c => allowedSet.has(c) && remaining(c) > 0 &&
        !(needsCurve && (c === 'cajaMagica' || c === 'tragaMonedas')) &&
        !(c === 'cajaMagica' && typeof options.maxCajaMagica === 'number' && (usage.cajaMagica ?? 0) >= options.maxCajaMagica) &&
        !(c === 'tragaMonedas' && typeof options.maxTragaMonedas === 'number' && (usage.tragaMonedas ?? 0) >= options.maxTragaMonedas)
      );
      for (const ac of altCats) {
        const tryShapes: TileShape[] = needsCurve ? ['curve'] : ['straight'];
        for (const s of tryShapes) {
          tileMeta = createTileFromCategory(ac, effectiveColor, s, requiredConnectors, specialCount, only1StarPuntos);
          if (tileMeta) { category = ac; break; }
        }
        if (tileMeta) break;
      }
    }
    if (!tileMeta) {
      errors.push(`No se pudo orientar en (${cell.x},${cell.y}) cat=${category} shape=${shape}`);
      continue;
    }

    // Re-calcular willBe2Estrellas por si la categoría cambió en los fallbacks
    if (category === 'puntos' && !only1StarPuntos && specialCount >= 3 && specialCount % 4 === 3) {
      willBe2Estrellas = true;
    }

    // Sobrescribir assetKey para PORTAL: usar la familia exacta
    if (category === 'portal') {
      const famToUse: PortalFamily | null =
        chosenPortalFamily ??
        pendingPortalFamily ??
        (isPortalFamilyComplete('blanco') ? (isPortalFamilyComplete('azul') ? null : 'azul') : 'blanco');
      if (famToUse) {
        const nextKey = pickNextPortalKeyForFamily(famToUse);
        if (nextKey) {
          tileMeta.assetKey = nextKey;
          tileMeta.isNeutral = true;
          tileMeta.color = 'neutral';
        }
      }
    }

    // Sobrescribir assetKey para 2Estrellas: forzar asset + neutral + straight
    if (category === 'puntos' && willBe2Estrellas) {
      tileMeta.assetKey = '2Estrellas';
      tileMeta.isNeutral = true;
      tileMeta.color = 'neutral';
      tileMeta.puntosAmount = 2;
      tileMeta.shape = 'straight';
    }

    // SINCRONIZACIÓN CRÍTICA: los overrides de PORTAL y 2Estrellas establecen
    // tileMeta.color a 'neutral' y tileMeta.shape. Pasamos estos valores a
    // effectiveColor para que placed.color, incrementColorUsage y stats sean correctos
    // (el spread {...tileMeta, color: effectiveColor} NO pise el neutral establecido).
    if (tileMeta.isNeutral || tileMeta.assetKey === '2Estrellas') {
      effectiveColor = tileMeta.color;
      if (tileMeta.assetKey === '2Estrellas') {
        // Garantía doble: shape siempre straight para 2Estrellas aunque fallback orientación haya cambiado
        tileMeta.shape = 'straight';
      }
    }

    const placed: PlacedTile = {
      ...tileMeta,
      id: `${category}-${cell.x}-${cell.y}-${cell.pathStep}`,
      x: cell.x,
      y: cell.y,
      pathStep: cell.pathStep,
      branchId: cell.branchId,
      parentStep: cell.parentStep,
      color: effectiveColor,
    };

    tiles.set(key, placed);
    usage[category]++;
    if (category === 'desvio') {
      if (shape === 'intersection3') { desv3Used++; }
      else if (shape === 'intersection4') { desv4Used++; }
    }
    incrementColorUsage(category, effectiveColor);

    // GARANTÍA: cooldown se establece POR CATEGORÍA FINAL (después de todos los fallbacks).
    // Así aunque categoría cambie por resolveColor/duplicate-switch/shape-force, la
    // separación por MISMO TIPO que pidió el usuario se cumple siempre.
    if (category !== 'normal' && category !== 'curve' && category !== 'inicio' && category !== 'final') {
      cooldownByCategory[category] = minSameCategoryGap;
    }
    if (MOVEMENT_CATEGORIES.includes(category)) {
      movementCooldown = Math.max(movementCooldown, minMovementGap);
      if (!placed.springSubtype) {
        // Si terminó siendo movement sin subtipo explícito, no contamos como especial extra
      }
    }

    placedSequence.push({
      key,
      cat: category,
      color: effectiveColor,
      step: cell.pathStep,
    });

    if (placed.springSubtype) {
      springSubtypeUsage[placed.springSubtype] = (springSubtypeUsage[placed.springSubtype] ?? 0) + 1;
      springSubtypeSteps[placed.springSubtype].push(cell.pathStep);
    }

    if (placed.category === 'portal') {
      const fam = PORTAL_FAMILY_BY_KEY[placed.assetKey];
      if (fam) {
        portalUsageByFamily[fam].usedKeys.add(placed.assetKey);
        portalUsageByFamily[fam].steps.push(cell.pathStep);
        portalUsageByFamily[fam].coords.push({ x: cell.x, y: cell.y });
        if (portalUsageByFamily[fam].usedKeys.size >= 2) {
          pendingPortalFamily = null;
          pendingPortalPlacementTries = 0;
        }
      }
    }

    for (const k of Object.keys(cooldownByCategory)) {
      cooldownByCategory[k] = Math.max(0, cooldownByCategory[k] - 1);
    }
    if (movementCooldown > 0) movementCooldown--;
  }

  for (const [key, cell] of grid) {
    if (tiles.has(key)) continue;
    const shape = classifyShape(cell);
    const colorAssign = colorAssignments.get(key);
    const preferredColor: TileColor =
      colorAssign?.color && colorAssign.color !== 'neutral'
        ? colorAssign.color
        : (COLOR_CYCLE[cell.pathStep % 4] as TileColor);
    const req: Direction[] = [];
    if (cell.incoming) req.push(cell.incoming);
    for (const od of cell.outgoing) req.push(od);
    const isIntersection = shape === 'intersection3' || shape === 'intersection4';
    // Filtro por subtipo de intersección (regla Moderada solo I3)
    let desvioPermittedFb = allowedSet.has('desvio');
    if (desvioPermittedFb && isIntersection) {
      if (shape === 'intersection3') { if (desv3Used >= desv3Max) desvioPermittedFb = false; }
      else if (shape === 'intersection4') { if (!allow4WayIntersection || desv4Used >= desv4Max) desvioPermittedFb = false; }
    }
    const prefersCurve = shape === 'curve';
    const fbValidSprings = getValidSpringSubtypes(
      cell.pathStep,
      springSubtypeUsage,
      springSubtypeSteps,
      allowedCategories
    );
    const priorityCats: TileCategory[] = [];
    if (isIntersection) {
      if (desvioPermittedFb) priorityCats.push('desvio');
    } else if (prefersCurve) {
      // REGLA DURA EN FALLBACK: si classifyShape=curve, SOLO probamos category='curve'.
      priorityCats.push('curve');
    } else {
      priorityCats.push(...(['normal', 'curve', 'puntos', 'carcel', 'tragaMonedas', 'cajaMagica', 'portal', 'avanzar', 'retroceder'] as TileCategory[]).filter(c => allowedSet.has(c)
        && (!MOVEMENT_CATEGORIES.includes(c) || fbValidSprings.some(s => SPRING_SUBTYPE_INFO[s].category === c))));
    }
    let placed: PlacedTile | null = null;
    let chosenCat: TileCategory = 'normal';
    let chosenColor: TileColor = preferredColor;
    for (const cat of priorityCats) {
      if (remaining(cat) <= 0) continue;
      if (cat !== 'desvio' && cat !== 'inicio' && cat !== 'final' && !hasAnyColorRemainingFor(cat)) continue;
      // REGLA DURA: shapesToTry SOLO el shape correcto.
      // - Si isIntersection: solo el shape real.
      // - Si prefersCurve (classifyShape=curve): SOLO 'curve'.
      // - En straight: SOLO 'straight'.
      // NUNCA permitimos curve↔straight como fallback.
      const shapesToTry: TileShape[] = isIntersection
        ? [shape]
        : prefersCurve
        ? ['curve']
        : ['straight'];
      let effectiveCatColor: TileColor | null;
      if (cat === 'desvio' || cat === 'inicio' || cat === 'final') {
        effectiveCatColor = 'neutral';
      } else if (MOVEMENT_CATEGORIES.includes(cat)) {
        const sub = pickSpringSubtypeForCategory(cat, fbValidSprings, rng);
        effectiveCatColor = sub
          ? pickColorForSpringSubtype(sub, preferredColor, cell.pathStep, rng)
          : pickAvailableColorFor(cat, preferredColor, cell.pathStep, rng);
      } else {
        effectiveCatColor = pickAvailableColorFor(cat, preferredColor, cell.pathStep, rng);
      }
      if (!effectiveCatColor) continue;
      for (const s of shapesToTry) {
        const meta = createTileFromCategory(cat, effectiveCatColor, s, req, usage.carcel + usage.puntos, only1StarPuntos);
        if (meta) {
          chosenCat = cat;
          chosenColor = effectiveCatColor;
          placed = {
            ...meta,
            id: `${cat}-${cell.x}-${cell.y}-fallback`,
            x: cell.x,
            y: cell.y,
            pathStep: cell.pathStep,
            branchId: cell.branchId,
            parentStep: cell.parentStep,
          };
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      let anyCat: TileCategory | null = null;
      // REGLA DURA ESPECIAL para INTERSECCIONES: NUNCA se coloca normal/curve/etc.
      // - isIntersection → SOLO aceptamos category='desvio'.
      // - Si ya no hay inventario de desvío → celda queda VACÍA (mejor que romper la
      //   estructura de 3/4 bocas).
      if (isIntersection) {
        // No hacemos nada más; placed sigue siendo null.
      } else if (prefersCurve) {
        // REGLA DURA: SOLO probamos el shape geométricamente correcto.
        // - prefersCurve → SOLO 'curve'. NUNCA straight.
        // Si no hay categoría con inventario para ese shape → la celda queda vacía
        // (mejor tablero más pequeño que reglas rotas).
        const tryShapes: TileShape[] = ['curve'];
        let anyColor: TileColor | null = null;
        if (allowedSet.has('curve') && remaining('curve') > 0) {
          anyCat = 'curve';
          anyColor = pickAvailableColorFor('curve', preferredColor, cell.pathStep, rng);
        }
        // Si no hay curva disponible → NO forzamos straight. Celda queda vacía.
        if (anyCat) {
          if (!anyColor) anyColor = COLOR_CYCLE[cell.pathStep % 4] as TileColor;
          for (const s of tryShapes) {
            const meta = createTileFromCategory(anyCat, anyColor, s, req, 0, only1StarPuntos);
            if (meta) {
              chosenCat = anyCat;
              chosenColor = anyColor;
              placed = {
                ...meta,
                id: `lastresort-${cell.x}-${cell.y}`,
                x: cell.x,
                y: cell.y,
                pathStep: cell.pathStep,
                branchId: cell.branchId,
                parentStep: cell.parentStep,
              };
              break;
            }
          }
        }
      } else {
        // STRAIGHT (y no es intersección): probamos categorías normales con shape='straight'.
        const tryShapes: TileShape[] = ['straight'];
        let anyColor: TileColor | null = null;
        // STRICT: solo categorías con remaining > 0 100% (sin fallback sin comprobar inv)
        const allowedAnyCats: TileCategory[] = (['normal', 'curve', 'puntos', 'carcel', 'tragaMonedas', 'cajaMagica', 'portal'] as TileCategory[]).filter(c => allowedSet.has(c) && remaining(c) > 0);
        anyCat = allowedAnyCats[0] ?? null;
        if (anyCat) {
          if (anyCat === 'desvio' || anyCat === 'inicio' || anyCat === 'final') {
            anyColor = 'neutral';
          } else {
            for (const c of allowedAnyCats) {
              const col = pickAvailableColorFor(c, preferredColor, cell.pathStep, rng);
              if (col) { anyCat = c; anyColor = col; break; }
            }
          }
        }
        if (anyCat) {
          if (!anyColor) anyColor = COLOR_CYCLE[cell.pathStep % 4] as TileColor;
          for (const s of tryShapes) {
            const meta = createTileFromCategory(anyCat, anyColor, s, req, 0, only1StarPuntos);
            if (meta) {
              chosenCat = anyCat;
              chosenColor = anyColor;
              placed = {
                ...meta,
                id: `lastresort-${cell.x}-${cell.y}`,
                x: cell.x,
                y: cell.y,
                pathStep: cell.pathStep,
                branchId: cell.branchId,
                parentStep: cell.parentStep,
              };
              break;
            }
          }
        }
      }
    }
    if (placed) {
      placed.color = chosenColor;
      tiles.set(key, placed);
      usage[chosenCat] = (usage[chosenCat] || 0) + 1;
      if (chosenCat === 'desvio') {
        if (shape === 'intersection3') desv3Used++;
        else if (shape === 'intersection4') desv4Used++;
      }
      incrementColorUsage(chosenCat, chosenColor);
      if (placed.springSubtype) {
        springSubtypeUsage[placed.springSubtype] = (springSubtypeUsage[placed.springSubtype] ?? 0) + 1;
        springSubtypeSteps[placed.springSubtype].push(cell.pathStep);
      }
    }
  }

  // Post-limpieza en CASCADA (solo intersecciones incompletas):
  // 1. Calcular conectores válidos por tile (solo si vecino en tiles tiene conector inverso).
  // 2. Si una Intersection3 queda con <3 validConnectors O Intersection4 con <4 validConnectors
  //    → ELIMINARLA COMPLETAMENTE (es una regla dura del usuario).
  // 3. Repetir hasta que no haya cambios (borrar una intersección invalida conectores de sus vecinos).
  // 4. Para tiles no-intersección, solo se eliminan conectores inválidos (no se borra la tile),
  //    para no destruir el tablero si una curva se queda temporalmente con 1 boca.
  let postChanged2 = true;
  let postSafety2 = 0;
  while (postChanged2 && postSafety2++ < 20) {
    postChanged2 = false;
    const toDelete2: string[] = [];
    const toUpdate2: { tile: PlacedTile; validConnectors: Direction[] }[] = [];

    for (const [key, tile] of tiles) {
      // START Y END SON CASOS ESPECIALES: siempre conservan su conector único,
      // independientemente de la reciprocidad del vecino (nunca se invalidan).
      if (tile.shape === 'start') {
        if (tile.connectors.length === 0) tile.connectors = ['east'];
        continue; // no actualizar ni borrar nunca
      }
      if (tile.shape === 'end') {
        if (tile.connectors.length === 0) tile.connectors = ['west'];
        continue; // no actualizar ni borrar nunca
      }

      const validConnectors: Direction[] = [];
      for (const conn of tile.connectors) {
        const { dx, dy } = DIR_DELTA[conn];
        let neighbor = tiles.get(`${tile.x + dx},${tile.y + dy}`);
        let neighborBackOk = false;
        if (!neighbor && conn === 'west') {
          const maybeStart = tiles.get(`${tile.x - 2},${tile.y}`);
          if (maybeStart && maybeStart.shape === 'start' && maybeStart.connectors.includes('east')) {
            neighbor = maybeStart;
            neighborBackOk = true;
          }
        }
        if (neighbor) {
          const back = OPPOSITE_DIR[conn];
          if (!neighborBackOk) {
            neighborBackOk =
              neighbor.connectors.includes(back) ||
              (neighbor.shape === 'end') ||
              (neighbor.shape === 'start');
          }
          if (neighborBackOk) {
            validConnectors.push(conn);
          }
        } else {
          validConnectors.push(conn);
        }
      }

      let deleteIt = false;
      if (tile.shape === 'intersection3' && validConnectors.length < 3) deleteIt = true;
      if (tile.shape === 'intersection4' && validConnectors.length < 4) deleteIt = true;
      if (deleteIt) {
        toDelete2.push(key);
      } else if (validConnectors.length !== tile.connectors.length) {
        toUpdate2.push({ tile, validConnectors });
      }
    }

    for (const { tile, validConnectors } of toUpdate2) {
      tile.connectors = validConnectors;
    }
    for (const key of toDelete2) {
      const tile = tiles.get(key);
      if (tile) {
        const cat = tile.category;
        usage[cat] = Math.max(0, usage[cat] - 1);
        if (cat === 'desvio') {
          if (tile.shape === 'intersection3') desv3Used = Math.max(0, desv3Used - 1);
          else if (tile.shape === 'intersection4') desv4Used = Math.max(0, desv4Used - 1);
        }
        tiles.delete(key);
        postChanged2 = true;
      }
    }
  }

  // --- [PAREJAS DE INODOROS (PORTALES)] ---
  ensurePortalPairs(tiles, allowedSet, remaining, usage, colorUsage);

  enforceFinalEndpoints(tiles, grid, endCoords, usage, errors);
  enforceStartNeighbor(tiles, grid, startCoord, usage, errors);

  // --- [POST-SWEEP: BALANCE DE CAJAS Y TRAGAMONEDAS] ---
  balanceCajasAndTragamonedas(
    tiles,
    allowedSet,
    remaining,
    remainingColor,
    usage,
    colorUsage,
    options
  );

  // --- [POST-SWEEP: CLEANUP SIMPLIFICADO EN PUNTO FIJO] ---
  runCleanupModerada(tiles, grid, pathResult, usage, colorUsage, {
    minBranchLength: options.minBranchLength,
    desiredFinals: options.desiredFinals ?? 2,
  });

  return { tiles, usage, errors };
}

export { classifyShape };
