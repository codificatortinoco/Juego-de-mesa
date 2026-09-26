import type { Direction, TileShape, PlacedTile, TileColor } from '../data/tiles.js';
import {
  DIR_DELTA,
  OPPOSITE_DIR,
  COLOR_CYCLE,
  createTileFromCategory,
} from '../data/tiles.js';
import type { TileCategory, ColorName } from '../data/tileInventory.js';

// ============================================================
//  CLEANUP SHARED: helpers genéricos para cleanup de tiles
// ============================================================

export const MAX_ITER = 12;
export const COLOR_KEYS: ColorName[] = ['rojo', 'rosado', 'amarillo', 'azul'];
export function kCoord(x: number, y: number): string { return `${x},${y}`; }

export type ColorUsage = Record<string, Record<ColorName, number>>;

export function countTilesByCategory(
  tiles: Map<string, PlacedTile>,
  cat: TileCategory
): number {
  let c = 0;
  for (const t of tiles.values()) if (t.category === cat) c++;
  return c;
}

export function getDistFallback(
  tile: PlacedTile,
  startTile: PlacedTile | null,
  bfs: Map<string, number> | null
): number {
  const k = kCoord(tile.x, tile.y);
  if (bfs && bfs.has(k)) return bfs.get(k)!;
  if (typeof tile.pathStep === 'number') return tile.pathStep;
  if (startTile) {
    const sx = startTile.shape === 'start' ? startTile.x + 2 : startTile.x;
    const dx = Math.abs(sx - tile.x);
    const dy = Math.abs(startTile.y - tile.y);
    return dx + dy;
  }
  return 0;
}

/** Borra una celda y DESCONECTA sus vecinos recíprocos, reconstruyendo shape/category. */
export function removeTileAndDisconnect(
  tiles: Map<string, PlacedTile>,
  grid: Map<string, unknown> | undefined,
  usage: Record<string, number>,
  colorUsage: ColorUsage,
  keyToRemove: string
) {
  const t = tiles.get(keyToRemove);
  if (!t) return;
  // Desconectar vecinos
  for (const conn of t.connectors.slice()) {
    let dx = DIR_DELTA[conn].dx;
    const dy = DIR_DELTA[conn].dy;
    if (t.shape === 'start' && conn === 'east') dx = 2;
    const nx = t.x + dx;
    const ny = t.y + dy;
    let nk = kCoord(nx, ny);
    let neighbor = tiles.get(nk);
    if (!neighbor && conn === 'west' && t.shape !== 'start') {
      const maybeSK = kCoord(nx - 1, ny);
      const maybeS = tiles.get(maybeSK);
      if (maybeS && maybeS.shape === 'start' && maybeS.connectors.includes('east')) {
        neighbor = maybeS;
        nk = maybeSK;
      }
    }
    if (!neighbor) continue;
    const expectedBack = OPPOSITE_DIR[conn];
    const recip = (neighbor.shape === 'start' && expectedBack === 'east') || neighbor.connectors.includes(expectedBack);
    if (!recip) continue;
    const nb: Direction[] = neighbor.connectors.filter(c => c !== expectedBack);
    rebuildNeighborMeta(tiles, usage, colorUsage, neighbor, nk, nb);
  }
  // Actualizar usage del tile borrado
  usage[t.category] = Math.max(0, (usage[t.category] ?? 0) - 1);
  if (COLOR_KEYS.includes(t.color as ColorName)) {
    if (!colorUsage[t.category]) colorUsage[t.category] = { rojo: 0, rosado: 0, amarillo: 0, azul: 0 };
    colorUsage[t.category][t.color as ColorName] = Math.max(
      0,
      (colorUsage[t.category][t.color as ColorName] ?? 0) - 1
    );
  }
  tiles.delete(keyToRemove);
  if (grid) grid.delete(keyToRemove);
}

function rebuildNeighborMeta(
  tiles: Map<string, PlacedTile>,
  usage: Record<string, number>,
  colorUsage: ColorUsage,
  neighbor: PlacedTile,
  nk: string,
  newConnectors: Direction[]
) {
  if (neighbor.category === 'inicio') return;
  if (neighbor.category === 'final') {
    neighbor.connectors = newConnectors;
    return;
  }
  // Restar old usage
  usage[neighbor.category] = Math.max(0, (usage[neighbor.category] ?? 0) - 1);
  if (COLOR_KEYS.includes(neighbor.color as ColorName)) {
    if (!colorUsage[neighbor.category]) colorUsage[neighbor.category] = { rojo: 0, rosado: 0, amarillo: 0, azul: 0 };
    colorUsage[neighbor.category][neighbor.color as ColorName] = Math.max(
      0,
      (colorUsage[neighbor.category][neighbor.color as ColorName] ?? 0) - 1
    );
  }

  // Determinar shape/category
  let newShape: TileShape;
  let newCat: TileCategory;
  if (newConnectors.length <= 1) {
    newShape = 'straight';
    newCat = 'normal';
  } else if (newConnectors.length === 2) {
    const opposite =
      (newConnectors.includes('north') && newConnectors.includes('south')) ||
      (newConnectors.includes('east') && newConnectors.includes('west'));
    newShape = opposite ? 'straight' : 'curve';
    newCat = opposite ? 'normal' : 'curve';
  } else if (newConnectors.length === 3) {
    newShape = 'intersection3';
    newCat = 'desvio';
  } else {
    newShape = 'intersection4';
    newCat = 'desvio';
  }
  const step = typeof neighbor.pathStep === 'number' ? neighbor.pathStep : 0;
  const color: TileColor = newShape === 'intersection3' || newShape === 'intersection4'
    ? 'neutral'
    : COLOR_CYCLE[step % 4];

  const repl = createTileFromCategory(
    newCat,
    color,
    newShape,
    newConnectors,
    neighbor.rotation ?? 0,
    false
  ) as PlacedTile | null;

  if (repl) {
    const t: PlacedTile = {
      ...repl,
      x: neighbor.x,
      y: neighbor.y,
      pathStep: neighbor.pathStep,
      branchId: neighbor.branchId,
      parentStep: neighbor.parentStep,
      connectors: newConnectors,
    };
    tiles.set(nk, t);
    usage[t.category] = (usage[t.category] ?? 0) + 1;
    if (COLOR_KEYS.includes(t.color as ColorName)) {
      if (!colorUsage[t.category]) colorUsage[t.category] = { rojo: 0, rosado: 0, amarillo: 0, azul: 0 };
      colorUsage[t.category][t.color as ColorName] = (colorUsage[t.category][t.color as ColorName] ?? 0) + 1;
    }
  } else {
    neighbor.connectors = newConnectors;
    usage[neighbor.category] = (usage[neighbor.category] ?? 0) + 1;
    if (COLOR_KEYS.includes(neighbor.color as ColorName)) {
      if (!colorUsage[neighbor.category]) colorUsage[neighbor.category] = { rojo: 0, rosado: 0, amarillo: 0, azul: 0 };
      colorUsage[neighbor.category][neighbor.color as ColorName] =
        (colorUsage[neighbor.category][neighbor.color as ColorName] ?? 0) + 1;
    }
  }
}

/** BFS DESDE INICIO: devuelve reach, distance, start tile. */
export function bfsFromStart(
  tiles: Map<string, PlacedTile>
): { reach: Set<string>; distance: Map<string, number>; start: PlacedTile | null } {
  const start = Array.from(tiles.values()).find(t => t.category === 'inicio') || null;
  const reach = new Set<string>();
  const distance = new Map<string, number>();
  if (!start) return { reach, distance, start };
  const sk = kCoord(start.x, start.y);
  reach.add(sk);
  distance.set(sk, 0);
  const q: string[] = [sk];
  while (q.length) {
    const k = q.shift()!;
    const tile = tiles.get(k);
    if (!tile) continue;
    const d = distance.get(k) ?? 0;
    for (const conn of tile.connectors) {
      let dx = DIR_DELTA[conn].dx;
      const dy = DIR_DELTA[conn].dy;
      if (tile.shape === 'start' && conn === 'east') dx = 2;
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      let nk = kCoord(nx, ny);
      let neighbor = tiles.get(nk);
      if (!neighbor && conn === 'west' && tile.shape !== 'start') {
        const maybeS = tiles.get(kCoord(nx - 1, ny));
        if (maybeS && maybeS.shape === 'start' && maybeS.connectors.includes('east')) {
          neighbor = maybeS;
          nk = kCoord(nx - 1, ny);
        }
      }
      if (!neighbor) continue;
      const back = OPPOSITE_DIR[conn];
      const recip = (neighbor.shape === 'start' && back === 'east') || neighbor.connectors.includes(back);
      if (!recip) continue;
      if (!reach.has(nk)) {
        reach.add(nk);
        distance.set(nk, d + 1);
        q.push(nk);
      }
    }
  }
  return { reach, distance, start };
}
