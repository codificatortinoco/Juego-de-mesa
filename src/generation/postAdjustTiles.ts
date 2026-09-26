import type { Direction, PlacedTile, TileShape } from '../data/tiles';
import {
  DIR_DELTA,
  OPPOSITE_DIR,
  COLOR_CYCLE,
  BASE_CONNECTORS,
  createTileFromCategory,
  createEndTile,
  findRotationToMatch,
  rotateConnectors,
} from '../data/tiles';
import type { TileCategory, ColorName } from '../data/tileInventory';
import { getAsset } from '../data/assetMap';
import type { GridCell } from './generatePath';
import { COLOR_KEYS, type ColorUsage } from './cleanupShared';

export const PORTAL_PAIRS: Record<string, string> = {
  'InodoroBlanco-azul': 'InodoroBlanco-rosado',
  'InodoroBlanco-rosado': 'InodoroBlanco-azul',
  'InodoroAzul-amarillo': 'InodoroAzul-rojo',
  'InodoroAzul-rojo': 'InodoroAzul-amarillo',
};

export interface PostAdjustOptions {
  minCajaMagica?: number;
  maxCajaMagica?: number;
  maxTragaMonedas?: number;
}

/**
 * Garantiza que si existe un portal colocado, también exista su pareja correspondiente.
 */
export function ensurePortalPairs(
  tiles: Map<string, PlacedTile>,
  allowedSet: Set<TileCategory>,
  remaining: (cat: TileCategory) => number,
  usage: Record<TileCategory, number>,
  colorUsage: ColorUsage
): void {
  if (!allowedSet.has('portal')) return;

  const placedByAsset: Record<string, PlacedTile> = {};
  for (const t of tiles.values()) {
    if (t.category === 'portal') placedByAsset[t.assetKey] = t;
  }

  for (const placedAsset of Object.keys(placedByAsset)) {
    const pairAsset = PORTAL_PAIRS[placedAsset];
    if (!pairAsset || placedByAsset[pairAsset]) continue;

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
          connectors:
            rotation !== null
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
          colorUsage[oldCat][oldColor as ColorName] = Math.max(
            0,
            colorUsage[oldCat][oldColor as ColorName] - 1
          );
        }
        usage.portal++;
        placedByAsset[pairAsset] = newTile;
      }
    }
  }
}

/**
 * Garantiza que cada celda de Final sea un nodo terminal (shape='end', connectors=1).
 */
export function enforceFinalEndpoints(
  tiles: Map<string, PlacedTile>,
  grid: Map<string, GridCell>,
  endCoords: { x: number; y: number }[],
  usage: Record<TileCategory, number>,
  errors: string[]
): void {
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

/**
 * Garantiza la reciprocidad del conector de salida del Inicio (salto 2) con su primer vecino.
 */
export function enforceStartNeighbor(
  tiles: Map<string, PlacedTile>,
  grid: Map<string, GridCell>,
  startCoord: { x: number; y: number },
  usage: Record<TileCategory, number>,
  errors: string[]
): void {
  const startK = `${startCoord.x},${startCoord.y}`;
  const startT = tiles.get(startK);
  const startCell = grid.get(startK);
  if (!startT || !startCell) return;

  const sDir = startT.connectors[0] ?? 'east';
  if (sDir !== 'east' && sDir !== 'west') return;

  const sdx = DIR_DELTA[sDir].dx * 2;
  const sdy = DIR_DELTA[sDir].dy * 2;
  const nx = startT.x + sdx;
  const ny = startT.y + sdy;
  const nK = `${nx},${ny}`;
  const nCell = grid.get(nK);
  if (!nCell) return;

  const expectedBack = OPPOSITE_DIR[sDir];
  const nTile = tiles.get(nK);

  const req: Direction[] = [];
  if (nCell.incoming) req.push(nCell.incoming);
  for (const d of nCell.outgoing ?? []) req.push(d);
  const reqUnique = Array.from(new Set(req));
  if (reqUnique.length < 2 && !nCell.isEnd) reqUnique.push(expectedBack);

  const needsCurve =
    reqUnique.length === 2 &&
    (reqUnique.includes('north') || reqUnique.includes('south')) &&
    (reqUnique.includes('east') || reqUnique.includes('west')) &&
    !(reqUnique.includes('north') && reqUnique.includes('south')) &&
    !(reqUnique.includes('east') && reqUnique.includes('west'));

  const sh: TileShape =
    reqUnique.length === 3
      ? 'intersection3'
      : reqUnique.length === 4
      ? 'intersection4'
      : needsCurve
      ? 'curve'
      : 'straight';

  if (!nTile || !nTile.connectors.includes(expectedBack) || nTile.connectors.length !== reqUnique.length) {
    let replacement: PlacedTile | null = null;
    const colorCycle: ColorName[] = ['rosado', 'rojo', 'azul', 'amarillo'];
    for (const col of colorCycle) {
      replacement = createTileFromCategory(
        sh === 'curve' ? 'curve' : sh === 'straight' ? 'normal' : 'desvio',
        col,
        sh,
        reqUnique,
        0,
        false
      ) as PlacedTile | null;
      if (replacement) break;
    }
    if (!replacement) {
      replacement = createTileFromCategory(
        'normal',
        'rosado',
        'straight',
        reqUnique.includes('west') && reqUnique.includes('east')
          ? ['west', 'east']
          : reqUnique.includes('north') && reqUnique.includes('south')
          ? ['north', 'south']
          : [expectedBack, sDir as Direction],
        0,
        false
      ) as PlacedTile | null;
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
      if (prev) {
        errors.push(
          `Post-sweep START-NEIGHBOR FIX: tile en (${nx},${ny}) reemplazado para cumplir recíproca Start→${sDir} back=${expectedBack}.`
        );
      }
    } else {
      errors.push(
        `Post-sweep START-NEIGHBOR FALLO: sin reemplazo adecuado para (${nx},${ny}).`
      );
    }
  }
}

/**
 * Ajusta cantidades mínimas y máximas de Caja Mágica y Tragamonedas.
 */
export function balanceCajasAndTragamonedas(
  tiles: Map<string, PlacedTile>,
  allowedSet: Set<TileCategory>,
  remaining: (cat: TileCategory) => number,
  remainingColor: (cat: TileCategory, color: ColorName) => number,
  usage: Record<TileCategory, number>,
  colorUsage: ColorUsage,
  options: PostAdjustOptions
): void {
  const minC = allowedSet.has('cajaMagica') ? options.minCajaMagica : undefined;
  const maxC = allowedSet.has('cajaMagica') ? options.maxCajaMagica : undefined;
  const maxT = allowedSet.has('tragaMonedas') ? options.maxTragaMonedas : undefined;

  const countBy = (cat: TileCategory) =>
    Array.from(tiles.values()).filter((t) => t.category === cat).length;

  let cMagica = countBy('cajaMagica');
  let tMonedas = countBy('tragaMonedas');

  function tryDegrade(target: PlacedTile): PlacedTile | null {
    const step = target.pathStep ?? 0;
    const req: Direction[] = Array.from(target.connectors);
    const needsCurve =
      req.length === 2 &&
      (req.includes('north') || req.includes('south')) &&
      (req.includes('east') || req.includes('west')) &&
      !(req.includes('north') && req.includes('south')) &&
      !(req.includes('east') && req.includes('west'));
    const expectedColor = COLOR_CYCLE[Math.max(0, step) % 4] as ColorName;
    const primaryShape: TileShape = needsCurve ? 'curve' : 'straight';
    const altShape: TileShape = needsCurve ? 'straight' : 'curve';
    const primaryCat: TileCategory = needsCurve ? 'curve' : 'normal';
    const altCat: TileCategory = needsCurve ? 'normal' : 'curve';
    const attempts: Array<{ cat: TileCategory; shape: TileShape; color: ColorName | null }> = [
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
        : (COLOR_KEYS as ColorName[]).filter((c) => remainingColor(a.cat, c) > 0);
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
      .filter((t) => t.category === 'cajaMagica')
      .sort((a, b) => (a.pathStep ?? 0) - (b.pathStep ?? 0));
    for (let i = maxC; i < ordered.length; i++) {
      const target = ordered[i];
      const k = `${target.x},${target.y}`;
      const replacement = tryDegrade(target);
      if (replacement) {
        const oldColor = target.color;
        usage.cajaMagica = Math.max(0, usage.cajaMagica - 1);
        if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
          colorUsage.cajaMagica[oldColor as ColorName] = Math.max(
            0,
            colorUsage.cajaMagica[oldColor as ColorName] - 1
          );
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
          colorUsage[next.category][next.color as ColorName] =
            (colorUsage[next.category][next.color as ColorName] ?? 0) + 1;
        }
        cMagica--;
      }
    }
  }

  const isStraightCell = (req: Direction[]) =>
    req.length === 2 &&
    ((req.includes('west') && req.includes('east')) ||
      (req.includes('north') && req.includes('south')));

  // Forzar mínimos de caja
  if (typeof minC === 'number' && cMagica < minC) {
    const candidates = Array.from(tiles.values())
      .filter((t) => {
        if (t.shape === 'start' || t.shape === 'end') return false;
        if (t.shape === 'intersection3' || t.shape === 'intersection4') return false;
        if (t.category === 'inicio' || t.category === 'final' || t.category === 'desvio') return false;
        if (t.category === 'cajaMagica') return false;
        if (t.color === 'neutral') return false;
        const step = t.pathStep ?? 0;
        const expectedColor = COLOR_CYCLE[Math.max(0, step) % 4] as ColorName;
        if (t.color !== expectedColor) return false;
        const req: Direction[] = Array.from(t.connectors);
        return isStraightCell(req);
      })
      .sort((a, b) => {
        const aPriority = a.category === 'tragaMonedas' ? 0 : 1;
        const bPriority = b.category === 'tragaMonedas' ? 0 : 1;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return Math.abs((a.pathStep ?? 20) - 20) - Math.abs((b.pathStep ?? 20) - 20);
      });

    for (const cand of candidates) {
      if (cMagica >= minC) break;
      if (countBy('cajaMagica') >= (typeof maxC === 'number' ? maxC : 999)) break;
      if (remainingColor('cajaMagica', cand.color as ColorName) <= 0) continue;
      const req: Direction[] = Array.from(cand.connectors);
      const replacement = createTileFromCategory(
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
        colorUsage[oldCat][oldColor as ColorName] = Math.max(
          0,
          colorUsage[oldCat][oldColor as ColorName] - 1
        );
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
    }

    // Fallback sin color match estricto
    if (cMagica < minC) {
      const candidates2 = Array.from(tiles.values())
        .filter((t) => {
          if (t.shape === 'start' || t.shape === 'end') return false;
          if (t.shape === 'intersection3' || t.shape === 'intersection4') return false;
          if (t.category === 'inicio' || t.category === 'final' || t.category === 'desvio') return false;
          if (t.category === 'cajaMagica') return false;
          const req: Direction[] = Array.from(t.connectors);
          return isStraightCell(req);
        })
        .sort((a, b) => {
          const aPriority = a.category === 'tragaMonedas' ? 0 : 1;
          const bPriority = b.category === 'tragaMonedas' ? 0 : 1;
          return aPriority - bPriority;
        });

      for (const cand of candidates2) {
        if (cMagica >= minC) break;
        if (countBy('cajaMagica') >= (typeof maxC === 'number' ? maxC : 999)) break;
        const col =
          cand.color === 'neutral'
            ? (COLOR_CYCLE[Math.max(0, cand.pathStep ?? 0) % 4] as ColorName)
            : (cand.color as ColorName);
        if (remainingColor('cajaMagica', col) <= 0) continue;
        const req: Direction[] = Array.from(cand.connectors);
        const replacement = createTileFromCategory(
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
          colorUsage[oldCat][oldColor as ColorName] = Math.max(
            0,
            colorUsage[oldCat][oldColor as ColorName] - 1
          );
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

    // Fallback extremo
    if (cMagica < minC) {
      const lastCandidates = Array.from(tiles.values())
        .filter((t) => {
          if (
            t.category === 'inicio' ||
            t.category === 'final' ||
            t.category === 'desvio' ||
            t.category === 'cajaMagica'
          ) {
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          const aPriority = a.category === 'tragaMonedas' ? 0 : 1;
          const bPriority = b.category === 'tragaMonedas' ? 0 : 1;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return Math.abs((a.pathStep ?? 15) - 15) - Math.abs((b.pathStep ?? 15) - 15);
        });

      for (const cand of lastCandidates) {
        if (cMagica >= minC) break;
        if (countBy('cajaMagica') >= (typeof maxC === 'number' ? maxC : 999)) break;
        const step = cand.pathStep ?? 0;
        const expColor = COLOR_CYCLE[Math.max(0, step) % 4] as ColorName;
        let col: ColorName =
          cand.color !== 'neutral' && COLOR_KEYS.includes(cand.color as ColorName)
            ? (cand.color as ColorName)
            : expColor;
        if (remainingColor('cajaMagica', col) <= 0) {
          const anyAvail = COLOR_KEYS.find((c) => remainingColor('cajaMagica', c) > 0);
          if (!anyAvail) continue;
          col = anyAvail;
        }
        const reqOriginal: Direction[] = Array.from(cand.connectors);
        let replacement = createTileFromCategory(
          'cajaMagica',
          col,
          'straight',
          reqOriginal,
          0,
          false
        ) as PlacedTile | null;

        if (!replacement) {
          const reqStraight =
            reqOriginal.includes('west') || reqOriginal.includes('east')
              ? (['west', 'east'] as Direction[])
              : (['north', 'south'] as Direction[]);
          replacement = createTileFromCategory(
            'cajaMagica',
            col,
            'straight',
            reqStraight,
            0,
            false
          ) as PlacedTile | null;
        }
        if (!replacement) continue;

        const k = `${cand.x},${cand.y}`;
        const oldCat = cand.category;
        const oldColor = cand.color;
        usage[oldCat] = Math.max(0, usage[oldCat] - 1);
        if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
          colorUsage[oldCat][oldColor as ColorName] = Math.max(
            0,
            colorUsage[oldCat][oldColor as ColorName] - 1
          );
        }
        const next: PlacedTile = {
          ...replacement,
          x: cand.x,
          y: cand.y,
          pathStep: cand.pathStep,
          branchId: cand.branchId,
          parentStep: cand.parentStep,
          connectors:
            replacement.connectors && replacement.connectors.length
              ? replacement.connectors
              : cand.connectors.length
              ? cand.connectors
              : replacement.connectors,
        };
        tiles.set(k, next);
        usage.cajaMagica++;
        if (COLOR_KEYS.includes(col)) colorUsage.cajaMagica[col]++;
        if (oldCat === 'tragaMonedas') tMonedas = Math.max(0, tMonedas - 1);
        cMagica++;
      }
    }
  }

  // Degradar sobrantes de tragamonedas
  if (typeof maxT === 'number' && tMonedas > maxT) {
    const ordered = Array.from(tiles.values())
      .filter((t) => t.category === 'tragaMonedas')
      .sort((a, b) => (a.pathStep ?? 0) - (b.pathStep ?? 0));
    for (let i = maxT; i < ordered.length; i++) {
      const target = ordered[i];
      const k = `${target.x},${target.y}`;
      const replacement = tryDegrade(target);
      if (replacement) {
        const oldColor = target.color;
        usage.tragaMonedas = Math.max(0, usage.tragaMonedas - 1);
        if (oldColor !== 'neutral' && COLOR_KEYS.includes(oldColor as ColorName)) {
          colorUsage.tragaMonedas[oldColor as ColorName] = Math.max(
            0,
            colorUsage.tragaMonedas[oldColor as ColorName] - 1
          );
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
          colorUsage[next.category][next.color as ColorName] =
            (colorUsage[next.category][next.color as ColorName] ?? 0) + 1;
        }
        tMonedas--;
      }
    }
  }
}
