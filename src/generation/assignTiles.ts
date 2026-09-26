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
  BASE_CONNECTORS,
  findRotationToMatch,
  rotateConnectors,
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
import { getAsset } from '../data/assetMap';
import { runCleanupModerada } from './cleanupModerada';

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

export const PORTAL_PAIRS: Record<string, string> = {
  'InodoroBlanco-azul': 'InodoroBlanco-rosado',
  'InodoroBlanco-rosado': 'InodoroBlanco-azul',
  'InodoroAzul-amarillo': 'InodoroAzul-rojo',
  'InodoroAzul-rojo': 'InodoroAzul-amarillo',
};

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

  const desv3Max = (TILE_INVENTORY.desvio as any).sub?.desv3 ?? 0;
  const desv4Max = (TILE_INVENTORY.desvio as any).sub?.desv4 ?? 0;
  let desv3Used = 0;
  let desv4Used = 0;

  function coordKeyLocal(x: number, y: number): string {
    return `${x},${y}`;
  }
  // --- PRE-CLEANUP: Si !allow4WayIntersection, TRANSFORMAR I4→I3 de forma SEGURA. ---
  // ESTRATEGIA: Conservar cell.incoming (dirección troncal) y quitar SÓLO un outgoing (rama).
  // Actualizar vecino recíproco + cascade <2 + recalc. Fixed-point.
  if (!allow4WayIntersection) {
    let preChanged = true;
    let preSafety = 0;
    while (preChanged && preSafety++ < 15) {
      preChanged = false;
      const delCells: string[] = [];

      for (const cell of grid.values()) {
        if (cell.isStart || cell.isEnd) continue;
        if (cell.numConnectors !== 4) continue;

        const origDirs: Direction[] = [];
        for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
          const { dx, dy } = DIR_DELTA[d];
          if (grid.has(coordKeyLocal(cell.x + dx, cell.y + dy))) origDirs.push(d);
        }
        if (cell.x === startCoord.x + 1 && cell.y === startCoord.y && !origDirs.includes('west')) origDirs.push('west');
        if (origDirs.length < 3) continue;

        // Paso 1: reducir a 3 direcciones cortando la 4ª (si hay 4)
        while (origDirs.length > 3) origDirs.pop();

        // Conservar incoming (tronco) si existe en origDirs
        let inc: Direction | null = cell.incoming;
        if (!inc || !origDirs.includes(inc)) inc = origDirs[0];
        let outs = origDirs.filter((d: Direction) => d !== inc);

        // Calcular removedDir (dirección de la rama que SE ELIMINA)
        const allFull: Direction[] = [];
        for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
          const { dx, dy } = DIR_DELTA[d];
          const had = grid.has(coordKeyLocal(cell.x + dx, cell.y + dy)) ||
            (cell.x === startCoord.x + 1 && cell.y === startCoord.y && d === 'west');
          if (had) allFull.push(d);
        }
        let remDir: Direction | null = null;
        for (const d of allFull) {
          if (!origDirs.includes(d)) { remDir = d; break; }
        }
        if (!remDir) {
          // Fallback: sacar el último outgoing
          const rr = outs.pop()!;
          remDir = rr;
          origDirs.length = 0;
          origDirs.push(inc);
          for (const o of outs) origDirs.push(o);
        }

        // Aplicar I3
        cell.incoming = inc;
        cell.outgoing = outs.slice(0, 2);
        const sc = new Set<Direction>();
        if (cell.incoming) sc.add(cell.incoming);
        for (const od of cell.outgoing) sc.add(od);
        cell.numConnectors = sc.size;
        cell.isIntersection = cell.numConnectors === 3 || cell.numConnectors === 4;
        preChanged = true;

        // Vecino recíproco del removido
        if (remDir) {
          const { dx, dy } = DIR_DELTA[remDir];
          const nKey = coordKeyLocal(cell.x + dx, cell.y + dy);
          const nCell = grid.get(nKey);
          if (nCell && !nCell.isStart && !nCell.isEnd) {
            const recip = OPPOSITE_DIR[remDir];
            const nLoc: Direction[] = [];
            for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
              if (d === recip) continue;
              const { dx: ndx, dy: ndy } = DIR_DELTA[d];
              if (grid.has(coordKeyLocal(nCell.x + ndx, nCell.y + ndy))) nLoc.push(d);
            }
            if (nCell.x === startCoord.x + 1 && nCell.y === startCoord.y && !nLoc.includes('west')) nLoc.push('west');
            if (nLoc.length === 0) {
              nCell.incoming = null; nCell.outgoing = []; nCell.numConnectors = 0; nCell.isIntersection = false;
            } else {
              if (nCell.incoming && nLoc.includes(nCell.incoming)) {
                nCell.outgoing = nLoc.filter((d: Direction) => d !== nCell.incoming);
              } else {
                nCell.incoming = nLoc[0];
                nCell.outgoing = nLoc.slice(1);
              }
              const scn = new Set<Direction>();
              if (nCell.incoming) scn.add(nCell.incoming);
              for (const od of nCell.outgoing) scn.add(od);
              nCell.numConnectors = scn.size;
              nCell.isIntersection = nCell.numConnectors === 3 || nCell.numConnectors === 4;
            }
            preChanged = true;
          }
        }
      }

      // 3. cascade <2 vecinos + PROTECCIÓN EXTRA
      let casc = true;
      let cs = 0;
      while (casc && cs++ < 30) {
        casc = false;
        for (const cell of grid.values()) {
          if (cell.isStart || cell.isEnd) continue;

          let isAdjStart = false;
          let isAdjEnd = false;
          for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
            const { dx, dy } = DIR_DELTA[d];
            const nk = coordKeyLocal(cell.x + dx, cell.y + dy);
            const nb = grid.get(nk);
            if (nb && nb.isEnd) isAdjEnd = true;
          }
          if (Math.abs(cell.x - (startCoord.x + 1)) + Math.abs(cell.y - startCoord.y) <= 2) isAdjStart = true;
          if (Math.abs(cell.x - startCoord.x) + Math.abs(cell.y - startCoord.y) <= 2) isAdjStart = true;
          // Extra: proteger primeras 3 celdas de la fila del Start
          if (cell.y === startCoord.y && (cell.x === startCoord.x + 1 || cell.x === startCoord.x + 2 || cell.x === startCoord.x + 3)) isAdjStart = true;
          if (isAdjStart || isAdjEnd) continue;

          const nb: Direction[] = [];
          for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
            const { dx, dy } = DIR_DELTA[d];
            if (grid.has(coordKeyLocal(cell.x + dx, cell.y + dy))) nb.push(d);
          }
          if (cell.x === startCoord.x + 1 && cell.y === startCoord.y && !nb.includes('west')) nb.push('west');
          if (nb.length < 2) { delCells.push(coordKeyLocal(cell.x, cell.y)); casc = true; preChanged = true; }
        }
        for (const k of delCells) grid.delete(k);
        delCells.length = 0;
      }

      // 4. VALIDAR conectores (mismo patrón que generatePath: no reconstruir desde vecinos)
      for (const cell of grid.values()) {
        const validDirs = new Set<Direction>();
        for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
          const { dx, dy } = DIR_DELTA[d];
          if (grid.has(coordKeyLocal(cell.x + dx, cell.y + dy))) validDirs.add(d);
        }
        if (cell.x === startCoord.x + 1 && cell.y === startCoord.y) validDirs.add('west');

        if (cell.isStart) {
          const keepOut = cell.outgoing.filter((d: Direction) => d === 'east');
          cell.outgoing = keepOut.length > 0 ? keepOut : ['east'];
          cell.incoming = null; cell.numConnectors = 1; cell.isIntersection = false; continue;
        }
        if (cell.isEnd) {
          cell.outgoing = [];
          let inc = cell.incoming;
          if (!inc || !validDirs.has(inc)) {
            inc = null;
            for (const d of ['west', 'north', 'east', 'south'] as Direction[]) {
              if (validDirs.has(d)) { inc = d; break; }
            }
          }
          cell.incoming = inc;
          cell.numConnectors = inc ? 1 : 0;
          cell.isIntersection = false; continue;
        }

        const validated = new Set<Direction>();
        if (cell.incoming && validDirs.has(cell.incoming)) validated.add(cell.incoming);
        for (const od of cell.outgoing) {
          if (validDirs.has(od)) validated.add(od);
        }
        if (validated.size === 0) {
          if (validDirs.size === 0) {
            cell.incoming = null; cell.outgoing = []; cell.numConnectors = 0; cell.isIntersection = false; continue;
          }
          const arr = [...validDirs];
          cell.incoming = arr[0];
          cell.outgoing = arr.slice(1);
          cell.numConnectors = arr.length;
        } else {
          const prefInc = (cell.incoming && validated.has(cell.incoming)) ? cell.incoming : [...validated][0];
          cell.incoming = prefInc;
          const outs: Direction[] = [];
          for (const v of validated) if (v !== prefInc) outs.push(v);
          cell.outgoing = outs;
          cell.numConnectors = validated.size;
        }
        cell.isIntersection = cell.numConnectors === 3 || cell.numConnectors === 4;
      }
    }
  }

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
    const inv = TILE_INVENTORY[cat] as any;
    const maxColor = inv.perColor?.[color] ?? 0;
    return maxColor - colorUsage[cat][color];
  }
  function incrementColorUsage(cat: TileCategory, color: ColorName | 'neutral') {
    if (color === 'neutral') return;
    if (COLOR_KEYS.includes(color as ColorName)) {
      colorUsage[cat][color as ColorName]++;
    }
  }
  function hasAnyColorRemainingFor(cat: TileCategory): boolean {
    const inv = TILE_INVENTORY[cat] as any;
    if (!inv.perColor) return remaining(cat) > 0;
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

  // =============================================================
  // NUEVA REGLA (FASE 3 — bifurcaciones): RAMA MÁS CORTA PENALIZAR
  // Calcular qué celdas (no intersección) caen dentro de la rama
  // más corta desde una intersección hasta cualquier Final.
  // Esas celdas tienen PRIORIDAD ALTA para categoría = Cárcel /
  // Tragamonedas / Retroceder (antes que normales/puntos).
  // =============================================================
  const shortBranchSet = new Set<string>();
  {
    const ckey = (x: number, y: number): string => `${x},${y}`;
    // PASO 1: BFS inverso desde TODOS los finales → distToAnyEnd[k] = pasos mínimos hasta cualquier final.
    // NOTA: Para máxima robustez, usamos ADYACENCIA FÍSICA del grid (grid.has). NO usamos cell.incoming/outgoing
    // porque en bifurcaciones/ramas laterales estas variables apuntan al path principal y omiten ramas.
    const distToAnyEnd = new Map<string, number>();
    const queueRev: { k: string; d: number }[] = [];
    for (const ec of endCoords) {
      const k = ckey(ec.x, ec.y);
      if (!distToAnyEnd.has(k)) {
        distToAnyEnd.set(k, 0);
        queueRev.push({ k, d: 0 });
      }
    }
    while (queueRev.length > 0) {
      const cur = queueRev.shift()!;
      const curT = grid.get(cur.k);
      if (!curT) continue;
      // Explorar las 4 direcciones; si el vecino existe en grid, está conectado (por construcción)
      for (const d of ['north','east','south','west'] as Direction[]) {
        let { dx, dy } = DIR_DELTA[d];
        // (A) Si la celda actual es Start y vamos hacia East, necesitamos dx=2 (salto 2 del inicio)
        if (curT.isStart && d === 'east') dx = 2;
        let nx = curT.x + dx;
        let ny = curT.y + dy;
        let nk = ckey(nx, ny);
        if (!distToAnyEnd.has(nk) && grid.has(nk)) {
          distToAnyEnd.set(nk, cur.d + 1);
          queueRev.push({ k: nk, d: cur.d + 1 });
          continue;
        }
        // (B) Caso especial Start dx=2 en dirección OPUSTA: Si curT es la celda siguiente a Start
        // y d=west y nx-2,ny es el Start → incluir
        if (d === 'west') {
          const farK = ckey(curT.x - 2, curT.y);
          const far = grid.get(farK);
          if (far && far.isStart && !distToAnyEnd.has(farK)) {
            distToAnyEnd.set(farK, cur.d + 1);
            queueRev.push({ k: farK, d: cur.d + 1 });
          }
        }
      }
    }

    // PASO 2: BFS FORWARD desde Start etiquetando rama corta.
    // ¡¡ IMPORTANTE !! No usamos cell.incoming/cell.outgoing del path (saben mal en ramas
    // laterales / I3/I4). Usamos parentDir (la dirección con la que el BFS entró a la celda).
    // outDirs = TODAS las direcciones conectadas MENOS parentDir.
    const shortMark = new Map<string, boolean>(); // k -> isShortBranch (excepto intersecciones y start/end)
    const queueFwd: { k: string; parentDir: Direction | null }[] = [];
    const sk = ckey(startCoord.x, startCoord.y);
    shortMark.set(sk, false);
    queueFwd.push({ k: sk, parentDir: null });
    const visitedFwd = new Set<string>([sk]);

    while (queueFwd.length > 0) {
      const cur = queueFwd.shift()!;
      const curK = cur.k;
      const curT = grid.get(curK);
      if (!curT) continue;
      // (a) Determinar TODAS las direcciones con conexión real de curT.
      const connDirs = new Set<Direction>();
      if (curT.incoming) connDirs.add(curT.incoming);
      for (const o of curT.outgoing) connDirs.add(o);
      // Caso adyacencia física (fallback): recorrer 4 direcciones y ver si vecino existe
      if (connDirs.size === 0 || curT.isIntersection) {
        for (const d of ['north','east','south','west'] as Direction[]) {
          const {dx,dy} = DIR_DELTA[d];
          let nx = curT.x + dx;
          let ny = curT.y + dy;
          let nk = ckey(nx, ny);
          if (grid.has(nk)) connDirs.add(d);
        }
      }
      // Start: dx=2 para east (como validateBoard: skip vecino inmediato)
      if (curT.isStart) {
        connDirs.delete('east');
        const far = ckey(curT.x + 2, curT.y);
        if (grid.has(far)) connDirs.add('east');
      }

      // (b) Determinar outDirs (salientes para el BFS): connDirs - parentDir
      const outDirs: Direction[] = [];
      for (const d of connDirs) {
        if (cur.parentDir != null && d === cur.parentDir) continue;
        outDirs.push(d);
      }
      // Start: asegurar que sale por east (salto 2)
      if (curT.isStart && outDirs.length === 0) outDirs.push('east');

      // (c) Si curT es intersección: clasificar bocas salientes por dist al final.
      let isIntersectionNow = false;
      const bocaShort = new Set<Direction>();
      if (!curT.isStart && !curT.isEnd && curT.numConnectors >= 3 && curT.isIntersection) {
        isIntersectionNow = true;
        const bocas: { d: Direction; dist: number }[] = [];
        for (const d of outDirs) {
          let { dx, dy } = DIR_DELTA[d];
          if (curT.isStart && d === 'east') dx = 2;
          const nk = ckey(curT.x + dx, curT.y + dy);
          const dd = distToAnyEnd.get(nk);
          if (dd != null) bocas.push({ d, dist: dd + 1 });
        }
        if (bocas.length >= 2) {
          bocas.sort((a, b) => a.dist - b.dist);
          const minD = bocas[0].dist;
          for (const b of bocas) if (b.dist === minD) bocaShort.add(b.d);
        }
      }

      // (d) Propagar a los vecinos salientes
      for (const d of outDirs) {
        let { dx, dy } = DIR_DELTA[d];
        if (curT.isStart && d === 'east') dx = 2;
        const nx = curT.x + dx;
        const ny = curT.y + dy;
        const nk = ckey(nx, ny);
        const neigh = grid.get(nk);
        if (!neigh) continue;
        if (visitedFwd.has(nk)) continue;
        let neighShort = shortMark.get(curK) ?? false;
        if (isIntersectionNow) neighShort = bocaShort.has(d);
        if (!neigh.isIntersection && !neigh.isStart && !neigh.isEnd) {
          shortMark.set(nk, neighShort);
        }
        visitedFwd.add(nk);
        queueFwd.push({ k: nk, parentDir: OPPOSITE_DIR[d] });
      }
    }
    for (const [k, v] of shortMark) {
      if (v) shortBranchSet.add(k);
    }
  }

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
    let needsCurve = shape === 'curve';
    let chosenPortalFamily: PortalFamily | null = null;
    let isIntersection =
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

      if (
        forcePortalFamily ||
        (movementCooldown <= 0 || forcePendingPair)
      ) {
        const totalLeft =
          allCells.length -
          allCells.findIndex((c) => c.pathStep === cell.pathStep);
        const specialProb =
          relaxSeparation && specialCount < 20
            ? Math.max(puntosDensity, 0.30)
            : specialCount < 12
            ? Math.max(puntosDensity, 0.30)
            : totalLeft > 24
            ? Math.max(puntosDensity, 0.22)
            : Math.max(0.08, puntosDensity * 0.6);

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
      let cat = initialCat;
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
        if (tileMeta) { finalShapeForCategory = s; break; }
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
          if (tileMeta) { category = ac; finalShapeForCategory = s; break; }
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
      finalShapeForCategory = 'straight';
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
        anyCat = null;
      } else if (prefersCurve) {
        // REGLA DURA: SOLO probamos el shape geométricamente correcto.
        // - prefersCurve → SOLO 'curve'. NUNCA straight.
        // Si no hay categoría con inventario para ese shape → la celda queda vacía
        // (mejor tablero más pequeño que reglas rotas).
        let tryShapes: TileShape[] = ['curve'];
        let anyColor: TileColor | null = null;
        if (allowedSet.has('curve') && remaining('curve') > 0) {
          anyCat = 'curve';
          tryShapes = ['curve'];
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
        let tryShapes: TileShape[] = ['straight'];
        let anyColor: TileColor | null = null;
        // STRICT: solo categorías con remaining > 0 100% (sin fallback sin comprobar inv)
        const allowedAnyCats: TileCategory[] = (['normal', 'curve', 'puntos', 'carcel', 'tragaMonedas', 'cajaMagica', 'portal'] as TileCategory[]).filter(c => allowedSet.has(c) && remaining(c) > 0);
        anyCat = allowedAnyCats[0] ?? null;
        tryShapes = ['straight'];
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
  // Si una loseta portal (inodoro) existe, debe existir su pareja correspondiente
  // (InodoroBlanco-azul ↔ InodoroAzul-amarillo, InodoroBlanco-rosado ↔ InodoroAzul-rojo)
  if (allowedSet.has('portal')) {
    const placedByAsset: Record<string, PlacedTile> = {};
    for (const t of tiles.values()) {
      if (t.category === 'portal') placedByAsset[t.assetKey] = t;
    }
    for (const placedAsset of Object.keys(placedByAsset)) {
      const pairAsset = PORTAL_PAIRS[placedAsset];
      if (!pairAsset || placedByAsset[pairAsset]) continue;

      // Falta la pareja. Reemplazar alguna celda normal/curve no-especial vecina cercana.
      const current = placedByAsset[placedAsset];
      let replacementTarget: PlacedTile | null = null;
      for (const candidate of tiles.values()) {
        if (candidate.shape === 'start' || candidate.shape === 'end') continue;
        if (candidate.category !== 'normal' && candidate.category !== 'curve') continue;
        if (candidate.assetKey === pairAsset) continue;
        const dist = Math.abs(candidate.x - current.x) + Math.abs(candidate.y - current.y);
        if (dist >= 6 && dist <= 20) {
          replacementTarget = candidate;
          break;
        }
      }
      if (!replacementTarget) {
        for (const candidate of tiles.values()) {
          if (candidate.shape === 'start' || candidate.shape === 'end') continue;
          if (candidate.category !== 'normal' && candidate.category !== 'curve') continue;
          replacementTarget = candidate;
          break;
        }
      }
      if (replacementTarget && remaining('portal') > 0) {
        const keyToReplace = `${replacementTarget.x},${replacementTarget.y}`;
        const oldCat = replacementTarget.category;
        const shapeForPortal = replacementTarget.shape;
        const newConnectors: Direction[] = Array.from(replacementTarget.connectors);

        // Buscar manualmente: crear tile con assetKey exacta (no usar getAssetKeyForCategory normal para portal)
        let replacementTileMeta: PlacedTile | null = null;
        const assetUrl = getAsset(pairAsset);
        if (assetUrl) {
          const baseConnectors = BASE_CONNECTORS[shapeForPortal] ?? BASE_CONNECTORS.straight;
          const rotation = findRotationToMatch(baseConnectors, newConnectors);
          replacementTileMeta = {
            id: `portal-pair-${keyToReplace}`,
            category: 'portal',
            color: 'neutral',
            shape: shapeForPortal,
            connectors: rotation !== null
              ? rotateConnectors(baseConnectors, rotation)
              : newConnectors,
            rotation: rotation ?? 0,
            assetKey: pairAsset,
            special: true,
            isNeutral: true,
            x: replacementTarget.x,
            y: replacementTarget.y,
            pathStep: replacementTarget.pathStep,
            branchId: replacementTarget.branchId,
            parentStep: replacementTarget.parentStep,
          };
        }

        if (replacementTileMeta) {
          const newTile: PlacedTile = {
            ...replacementTileMeta,
            color: 'neutral',
          };
          tiles.set(keyToReplace, newTile);
          usage[oldCat] = Math.max(0, usage[oldCat] - 1);
          const oldColor = replacementTarget.color;
          if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
            colorUsage[oldCat][oldColor as ColorName] = Math.max(0, colorUsage[oldCat][oldColor as ColorName] - 1);
          }
          usage.portal++;
          placedByAsset[pairAsset] = newTile;
        }
      }
    }
  }

  // =============================================================
  // POST-SWEEP FINAL — defensa final antes de devolver tiles.
  // Regla usuario: Final NUNCA en el medio del camino, NUNCA con
  // más de 1 conector real, NUNCA un "passthrough".
  // (1) Reemplazar tile por createEndTile(createIncoming) categ='final' shape='end' connectors=1.
  // (2) cell.numConnectors !== 1 || cell.outgoing !== [] || !cell.incoming → ERROR (invalidar semilla).
  // NOTA: NO usamos "vecinos físicos en grid" porque un Final
  //       en esquina/muelle puede tener 2-3 vecinos adyacentes en el grid
  //       sin estar conectado a ellos (paredes en la loseta). La conectividad
  //       real viene dada por connectors (no adyacencia).
  // =============================================================
  {
    const ckey = (x: number, y: number) => `${x},${y}`;
    for (const ec of endCoords) {
      const k = ckey(ec.x, ec.y);
      const cell = grid.get(k);
      if (!cell) {
        errors.push(`Post-sweep: celda Final en (${ec.x},${ec.y}) no existe en grid.`);
        continue;
      }
      if (cell.numConnectors !== 1 || (cell.outgoing?.length ?? 0) !== 0 || !cell.incoming) {
        errors.push(
          `Post-sweep: Final en (${ec.x},${ec.y}) numConnectors=${cell.numConnectors} (debe=1) / outgoing=${cell.outgoing?.length ?? 0} (debe=0) / incoming=${String(cell.incoming)} (no-null). Celda no es hoja real = está en el medio de un camino.`
        );
      }
      // Force replace tile with createEndTile (incoming direction) — garantiza connectors=1,
      // categ='final', shape='end', asset='Final'. NUNCA passthrough con 2 conectores.
      const incomingDir: Direction = cell.incoming ?? 'west';
      const forced: PlacedTile = {
        ...createEndTile(incomingDir),
        x: ec.x,
        y: ec.y,
        pathStep: cell.pathStep,
        branchId: cell.branchId,
        parentStep: cell.parentStep,
      };
      const previous = tiles.get(k);
      if (previous && previous.category !== 'final') {
        usage[previous.category] = Math.max(0, usage[previous.category] - 1);
        usage.final++;
      }
      tiles.set(k, forced);
    }
  }

  // =============================================================
  // POST-SWEEP START + PRIMERA CELDA (dx=2) — otro caso de defensa.
  // Start tile está en (startCoord.x, startCoord.y) con outgoing=[startDir].
  // Si startDir === 'east' | 'west', la celda contigua real está a dx=±2
  // (la celda x+1 está visualmente ocupada por el spanCols=2 del Start).
  // Garantizamos que el tile vecino TENGA conector OPPOSITE[startDir].
  // Si no lo tiene (por fallback de color / inventario roto en el sweep),
  // reemplazamos a pelo con un tile createTileFromCategory (normal) que
  // encaje, sin más excepciones.
  // =============================================================
  {
    const startK = `${startCoord.x},${startCoord.y}`;
    const startT = tiles.get(startK);
    const startCell = grid.get(startK);
    if (startT && startCell) {
      const sDir = startT.connectors[0] ?? 'east';
      if (sDir === 'east' || sDir === 'west') {
        const sdx = DIR_DELTA[sDir].dx * 2;
        const sdy = DIR_DELTA[sDir].dy * 2;
        const nx = startT.x + sdx;
        const ny = startT.y + sdy;
        const nK = `${nx},${ny}`;
        const nCell = grid.get(nK);
        if (nCell) {
          const expectedBack = OPPOSITE_DIR[sDir];
          const nTile = tiles.get(nK);
          // Reconstruir requiredConnectors a partir de cell.incoming/outgoing
          // (por si se modificó después del sweep).
          const req: Direction[] = [];
          if (nCell.incoming) req.push(nCell.incoming);
          for (const d of (nCell.outgoing ?? [])) req.push(d);
          const reqUnique = Array.from(new Set(req));
          if (reqUnique.length < 2 && !nCell.isEnd) reqUnique.push(expectedBack);
          const needsCurve =
            reqUnique.length === 2 &&
            (reqUnique.includes('north') || reqUnique.includes('south')) &&
            (reqUnique.includes('east') || reqUnique.includes('west')) &&
            !(reqUnique.includes('north') && reqUnique.includes('south')) &&
            !(reqUnique.includes('east') && reqUnique.includes('west'));
          const sh =
            reqUnique.length === 3 ? 'intersection3' :
            reqUnique.length === 4 ? 'intersection4' :
            needsCurve ? 'curve' : 'straight';
          if (!nTile || !nTile.connectors.includes(expectedBack) || nTile.connectors.length !== reqUnique.length) {
            let replacement: PlacedTile | null = null;
            const colorCycle: ColorName[] = ['rosado','rojo','azul','amarillo'];
            for (const col of colorCycle) {
              replacement = createTileFromCategory(sh === 'curve' ? 'curve' : sh === 'straight' ? 'normal' : 'desvio', col, sh, reqUnique, 0, false) as PlacedTile | null;
              if (replacement) break;
            }
            if (!replacement) {
              // Fallback desesperado: normal straight
              replacement = createTileFromCategory('normal', 'rosado', 'straight', reqUnique.includes('west') && reqUnique.includes('east') ? ['west','east'] : reqUnique.includes('north') && reqUnique.includes('south') ? ['north','south'] : [expectedBack, sDir as Direction], 0, false) as PlacedTile | null;
            }
            if (replacement) {
              const prev = tiles.get(nK);
              if (prev && prev.category !== 'inicio' && prev.category !== 'final') {
                usage[prev.category] = Math.max(0, usage[prev.category] - 1);
              }
              tiles.set(nK, {
                ...replacement,
                x: nx,
                y: ny,
                pathStep: nCell.pathStep,
                branchId: nCell.branchId,
                parentStep: nCell.parentStep,
              });
              usage[replacement.category]++;
              if (prev) errors.push(`Post-sweep START-NEIGHBOR FIX: tile en (${nx},${ny}) reemplazado para cumplir recíproca Start→${sDir} back=${expectedBack} (prev tenía connectors=[${prev?.connectors.join(',')}] req=[${reqUnique.join(',')}]).`);
            } else {
              errors.push(`Post-sweep START-NEIGHBOR FALLO: sin reemplazo adecuado para (${nx},${ny}) req=[${reqUnique.join(',')}].`);
            }
          }
        }
      }
    }
  }

  // =============================================================
  // POST-SWEEP CAJA MÁGICA & TRAGAMONEDAS (regla Tranquila)
  // En dificultades que tengan minCajaMagica / maxCajaMagica / maxTragaMonedas:
  // 1) Si el número de cajas está < minCajaMagica → reemplazar 1-3 celdas normal/curve
  //    por cajaMagica, escogiendo steps que tengan color exacto del ciclo cromático.
  // 2) Si el número de cajas > maxCajaMagica → degradar las sobrantes a normal/curve/puntos.
  // 3) Si tragaMonedas > maxTragaMonedas → degradar sobrantes.
  // =============================================================
  {
    const minC = allowedSet.has('cajaMagica')
      ? (options.minCajaMagica ?? undefined)
      : undefined;
    const maxC = allowedSet.has('cajaMagica')
      ? (options.maxCajaMagica ?? undefined)
      : undefined;
    const maxT = allowedSet.has('tragaMonedas')
      ? (options.maxTragaMonedas ?? undefined)
      : undefined;

    const countBy = (cat: TileCategory) =>
      Array.from(tiles.values()).filter(t => t.category === cat).length;

    let cMagica = countBy('cajaMagica');
    let tMonedas = countBy('tragaMonedas');

    // Helper: intenta degradar una loseta target a una categoría simple (normal/curve).
    // Prueba varias combinaciones shape/category/color hasta que una tenga stock y encaje.
    function tryDegrade(target: PlacedTile): PlacedTile | null {
      const step = target.pathStep ?? 0;
      const req: Direction[] = Array.from(target.connectors);
      const needsCurve = req.length === 2 &&
        ((req.includes('north') || req.includes('south')) &&
        (req.includes('east') || req.includes('west')) &&
        !(req.includes('north') && req.includes('south')) &&
        !(req.includes('east') && req.includes('west')));
      const expectedColor = COLOR_CYCLE[Math.max(0, step) % 4] as ColorName;
      const primaryShape: TileShape = needsCurve ? 'curve' : 'straight';
      const altShape: TileShape = needsCurve ? 'straight' : 'curve';
      const primaryCat: TileCategory = needsCurve ? 'curve' : 'normal';
      const altCat: TileCategory = needsCurve ? 'normal' : 'curve';
      const attempts: Array<{cat: TileCategory; shape: TileShape; color: ColorName | null}> = [
        { cat: primaryCat, shape: primaryShape, color: expectedColor },
        { cat: primaryCat, shape: primaryShape, color: null },
        { cat: altCat, shape: altShape, color: expectedColor },
        { cat: altCat, shape: altShape, color: null },
      ];
      for (const a of attempts) {
        if (a.color && remainingColor(a.cat, a.color) <= 0) continue;
        if (!a.color && remaining(a.cat) <= 0) continue;
        const colorsToTry: ColorName[] = a.color
          ? [a.color]
          : (COLOR_KEYS as ColorName[]).filter(c => remainingColor(a.cat, c) > 0);
        for (const col of colorsToTry) {
          const r = createTileFromCategory(a.cat, col, a.shape, req, 0, false) as PlacedTile | null;
          if (r) return r;
        }
      }
      return null;
    }

    // Degradar sobrantes de caja
    if (typeof maxC === 'number' && cMagica > maxC) {
      const ordered = Array.from(tiles.values())
        .filter(t => t.category === 'cajaMagica')
        .sort((a, b) => (a.pathStep ?? 0) - (b.pathStep ?? 0));
      for (let i = maxC; i < ordered.length; i++) {
        const target = ordered[i];
        const k = `${target.x},${target.y}`;
        const replacement = tryDegrade(target);
        if (replacement) {
          const oldColor = target.color;
          usage.cajaMagica = Math.max(0, usage.cajaMagica - 1);
          if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
            colorUsage.cajaMagica[oldColor as ColorName] = Math.max(0, colorUsage.cajaMagica[oldColor as ColorName] - 1);
          }
          const next: PlacedTile = {
            ...replacement,
            x: target.x,
            y: target.y,
            pathStep: target.pathStep,
            branchId: target.branchId,
            parentStep: target.parentStep,
          };
          tiles.set(k, next);
          usage[next.category] = (usage[next.category] ?? 0) + 1;
          if (COLOR_KEYS.includes(next.color as ColorName)) {
            colorUsage[next.category][next.color as ColorName] = (colorUsage[next.category][next.color as ColorName] ?? 0) + 1;
          }
          cMagica--;
        }
      }
    }

    // Forzar mínimos de caja (1 a 3)
    if (typeof minC === 'number' && cMagica < minC) {
      const isStraightCell = (req: Direction[]) => req.length === 2 &&
        ((req.includes('west') && req.includes('east')) ||
        (req.includes('north') && req.includes('south')));
      // Candidatos PRIMARIOS: categoria normal/avanzar/retroceder/carcel/puntos/tragaMonedas
      // STRAIGHT + color correcto. Incluimos tragaMonedas para doble efecto:
      // degradar traga→caja reduce tMonedas (maxT) y aumenta cMagica (minC).
      const candidates = Array.from(tiles.values()).filter(t => {
        if (t.shape === 'start' || t.shape === 'end') return false;
        if (t.shape === 'intersection3' || t.shape === 'intersection4') return false;
        if (t.category === 'inicio' || t.category === 'final' || t.category === 'desvio') return false;
        if (t.category === 'cajaMagica') return false;
        if (t.color === 'neutral') return false;
        const step = t.pathStep ?? 0;
        const expectedColor = COLOR_CYCLE[Math.max(0, step) % 4] as ColorName;
        if (t.color !== expectedColor) return false;
        const req: Direction[] = Array.from(t.connectors);
        if (!isStraightCell(req)) return false;
        return true;
      }).sort((a, b) => {
        const aPriority = (a.category === 'tragaMonedas' ? 0 : 1);
        const bPriority = (b.category === 'tragaMonedas' ? 0 : 1);
        if (aPriority !== bPriority) return aPriority - bPriority;
        const da = Math.abs((a.pathStep ?? 20) - 20);
        const db = Math.abs((b.pathStep ?? 20) - 20);
        return da - db;
      });

      for (const cand of candidates) {
        if (cMagica >= minC) break;
        if (countBy('cajaMagica') >= (typeof maxC === 'number' ? maxC : 999)) break;
        if (remainingColor('cajaMagica', cand.color as ColorName) <= 0) continue;
        const req: Direction[] = Array.from(cand.connectors);
        const replacement: PlacedTile | null = createTileFromCategory(
          'cajaMagica',
          cand.color as ColorName,
          'straight',
          req,
          0,
          false
        ) as PlacedTile | null;
        if (!replacement) continue;
        const k = `${cand.x},${cand.y}`;
        const oldCat = cand.category;
        const oldColor = cand.color;
        usage[oldCat] = Math.max(0, usage[oldCat] - 1);
        if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
          colorUsage[oldCat][oldColor as ColorName] = Math.max(0, colorUsage[oldCat][oldColor as ColorName] - 1);
        }
        const next: PlacedTile = {
          ...replacement,
          x: cand.x,
          y: cand.y,
          pathStep: cand.pathStep,
          branchId: cand.branchId,
          parentStep: cand.parentStep,
        };
        tiles.set(k, next);
        usage.cajaMagica++;
        if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
          colorUsage.cajaMagica[oldColor as ColorName]++;
        }
        if (oldCat === 'tragaMonedas') tMonedas = Math.max(0, tMonedas - 1);
        cMagica++;
        if (cMagica >= minC) break;
      }

      // Fallback sin color match estricto (STRAIGHT cells, candidatos más amplios
      if (cMagica < minC) {
        const candidates2 = Array.from(tiles.values()).filter(t => {
          if (t.shape === 'start' || t.shape === 'end') return false;
          if (t.shape === 'intersection3' || t.shape === 'intersection4') return false;
          if (t.category === 'inicio' || t.category === 'final' || t.category === 'desvio') return false;
          if (t.category === 'cajaMagica') return false;
          const req: Direction[] = Array.from(t.connectors);
          if (!isStraightCell(req)) return false;
          return true;
        }).sort((a, b) => {
          const aPriority = (a.category === 'tragaMonedas' ? 0 : 1);
          const bPriority = (b.category === 'tragaMonedas' ? 0 : 1);
          return aPriority - bPriority;
        });
        for (const cand of candidates2) {
          if (cMagica >= minC) break;
          if (countBy('cajaMagica') >= (typeof maxC === 'number' ? maxC : 999)) break;
          const col = cand.color === 'neutral'
            ? (COLOR_CYCLE[Math.max(0, cand.pathStep ?? 0) % 4] as ColorName)
            : (cand.color as ColorName);
          if (remainingColor('cajaMagica', col) <= 0) continue;
          const req: Direction[] = Array.from(cand.connectors);
          const replacement: PlacedTile | null = createTileFromCategory(
            'cajaMagica',
            col,
            'straight',
            req,
            0,
            false
          ) as PlacedTile | null;
          if (!replacement) continue;
          const k = `${cand.x},${cand.y}`;
          const oldCat = cand.category;
          const oldColor = cand.color;
          usage[oldCat] = Math.max(0, usage[oldCat] - 1);
          if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
            colorUsage[oldCat][oldColor as ColorName] = Math.max(0, colorUsage[oldCat][oldColor as ColorName] - 1);
          }
          const next: PlacedTile = {
            ...replacement,
            x: cand.x,
            y: cand.y,
            pathStep: cand.pathStep,
            branchId: cand.branchId,
            parentStep: cand.parentStep,
          };
          tiles.set(k, next);
          usage.cajaMagica++;
          if (COLOR_KEYS.includes(col)) colorUsage.cajaMagica[col]++;
          if (oldCat === 'tragaMonedas') tMonedas = Math.max(0, tMonedas - 1);
          cMagica++;
        }
      }

      // Fallback EXTREMO: aún faltan cajas y no hay candidatos straight suficientes.
      // Aceptamos reemplazar CUALQUIER loseta (incluso curve cells excepto inicio/final/desvio/caja).
      // Si createTileFromCategory falla con connectors curve, forzamos connectors straight
      // (menor de los males: cumplir sí o sí 1-3 cajas).
      if (cMagica < minC) {
        const lastCandidates = Array.from(tiles.values()).filter(t => {
          if (t.category === 'inicio' || t.category === 'final' || t.category === 'desvio' || t.category === 'cajaMagica') return false;
          return true;
        }).sort((a, b) => {
          const aPriority = (a.category === 'tragaMonedas' ? 0 : 1);
          const bPriority = (b.category === 'tragaMonedas' ? 0 : 1);
          if (aPriority !== bPriority) return aPriority - bPriority;
          const da = Math.abs((a.pathStep ?? 15) - 15);
          const db = Math.abs((b.pathStep ?? 15) - 15);
          return da - db;
        });
        for (const cand of lastCandidates) {
          if (cMagica >= minC) break;
          if (countBy('cajaMagica') >= (typeof maxC === 'number' ? maxC : 999)) break;
          const step = cand.pathStep ?? 0;
          const expColor = COLOR_CYCLE[Math.max(0, step) % 4] as ColorName;
          let col: ColorName = cand.color !== 'neutral' && COLOR_KEYS.includes(cand.color as ColorName)
            ? cand.color as ColorName
            : expColor;
          if (remainingColor('cajaMagica', col) <= 0) {
            const anyAvail = COLOR_KEYS.find(c => remainingColor('cajaMagica', c) > 0);
            if (!anyAvail) continue;
            col = anyAvail;
          }
          const reqOriginal: Direction[] = Array.from(cand.connectors);
          let replacement: PlacedTile | null = createTileFromCategory(
            'cajaMagica', col, 'straight', reqOriginal, 0, false
          ) as PlacedTile | null;

          if (!replacement) {
            const reqStraight = reqOriginal.includes('west') || reqOriginal.includes('east')
              ? (['west', 'east'] as Direction[])
              : (['north', 'south'] as Direction[]);
            replacement = createTileFromCategory(
              'cajaMagica', col, 'straight', reqStraight, 0, false
            ) as PlacedTile | null;
          }
          if (!replacement) continue;

          const k = `${cand.x},${cand.y}`;
          const oldCat = cand.category;
          const oldColor = cand.color;
          usage[oldCat] = Math.max(0, usage[oldCat] - 1);
          if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
            colorUsage[oldCat][oldColor as ColorName] = Math.max(0, colorUsage[oldCat][oldColor as ColorName] - 1);
          }
          const next: PlacedTile = {
            ...replacement,
            x: cand.x,
            y: cand.y,
            pathStep: cand.pathStep,
            branchId: cand.branchId,
            parentStep: cand.parentStep,
            connectors: (replacement.connectors && replacement.connectors.length) ? replacement.connectors : (cand.connectors.length ? cand.connectors : replacement.connectors),
          };
          tiles.set(k, next);
          usage.cajaMagica++;
          if (COLOR_KEYS.includes(col)) colorUsage.cajaMagica[col]++;
          if (oldCat === 'tragaMonedas') tMonedas = Math.max(0, tMonedas - 1);
          cMagica++;
          if (cMagica >= minC) break;
        }
      }
    }

    // Degradar sobrantes de tragamonedas
    if (typeof maxT === 'number' && tMonedas > maxT) {
      const ordered = Array.from(tiles.values())
        .filter(t => t.category === 'tragaMonedas')
        .sort((a, b) => (a.pathStep ?? 0) - (b.pathStep ?? 0));
      for (let i = maxT; i < ordered.length; i++) {
        const target = ordered[i];
        const k = `${target.x},${target.y}`;
        const replacement = tryDegrade(target);
        if (replacement) {
          const oldColor = target.color;
          usage.tragaMonedas = Math.max(0, usage.tragaMonedas - 1);
          if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
            colorUsage.tragaMonedas[oldColor as ColorName] = Math.max(0, colorUsage.tragaMonedas[oldColor as ColorName] - 1);
          }
          const next: PlacedTile = {
            ...replacement,
            x: target.x,
            y: target.y,
            pathStep: target.pathStep,
            branchId: target.branchId,
            parentStep: target.parentStep,
          };
          tiles.set(k, next);
          usage[next.category] = (usage[next.category] ?? 0) + 1;
          if (COLOR_KEYS.includes(next.color as ColorName)) {
            colorUsage[next.category][next.color as ColorName] = (colorUsage[next.category][next.color as ColorName] ?? 0) + 1;
          }
          tMonedas--;
        }
      }
    }

    // ================================================================
    // ================================================================
    // POST-SWEEP: CLEANUP SIMPLIFICADO (cleanupModerada.ts)
    // Antiguamente este bloque eran ~500 líneas con múltiples pasos
    // (BFS manuales, anti-ciclos, top-up de finales inventados...).
    // Ahora toda la lógica está en cleanupModerada.ts:
    //   PASO 1. Eliminar tiles con 0 connectors
    //   PASO 2. BFS desde Inicio + borrar islas
    //   PASO 3. Borrar hojas muertas (solo convertir a final si budget+dist)
    //   PASO 4. Forzar que SOLO path.endCoords sean finales (nunca 3).
    // ================================================================
    runCleanupModerada(tiles, grid, pathResult, usage as any, colorUsage as any, {
      minBranchLength: options.minBranchLength,
      desiredFinals: options.desiredFinals ?? 2,
    });
  }

  return { tiles, usage, errors };
}

export { classifyShape };
