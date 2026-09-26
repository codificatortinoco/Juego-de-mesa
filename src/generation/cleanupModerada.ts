import type { PlacedTile, Direction, TileShape, TileColor } from '../data/tiles.js';
import {
  DIR_DELTA,
  OPPOSITE_DIR,
  createEndTile,
  createTileFromCategory,
  COLOR_CYCLE,
} from '../data/tiles.js';
import type { TileCategory, ColorName } from '../data/tileInventory.js';
import type { PathResult } from './generatePath.js';
import {
  MAX_ITER,
  bfsFromStart,
  countTilesByCategory,
  getDistFallback,
  kCoord,
  COLOR_KEYS,
  removeTileAndDisconnect,
  type ColorUsage,
} from './cleanupShared.js';

export interface CleanupOptions {
  minBranchLength?: number;
  desiredFinals?: number;
}

export interface CleanupResult {
  tiles: Map<string, PlacedTile>;
  finalsCount: number;
  iterations: number;
  deletedIslands: number;
  deletedDeadLeaves: number;
}

/**
 * Cleanup de Moderada, SIMPLIFICADO y LEGIBLE.
 *
 * 4 pasos iterativos hasta punto fijo:
 *   PASO 1. Eliminar tiles con 0 connectors (no start).
 *   PASO 2. BFS desde Inicio. Borrar tiles no alcanzables (ISLAS).
 *   PASO 3. Borrar hojas muertas (1 connector, no start ni final).
 *           Si quedan hojas y tenemos budget finals + distancia → convertir a final.
 *   PASO 4. SOLO path.endCoords pueden ser finales.
 *           - Borrar finales que no estén en endCoords.
 *           - Crear finales en endCoords si faltan.
 *           - Asegurar vecino recíproco en cada final.
 *
 * Postcondición: 0 islas, 0 hojas muertas, finales ≤ 2.
 */
export function runCleanupModerada(
  tiles: Map<string, PlacedTile>,
  grid: Map<string, unknown>,
  path: PathResult,
  usage: Record<string, number>,
  colorUsage: ColorUsage,
  opts: CleanupOptions = {}
): CleanupResult {
  const { minBranchLength = 0, desiredFinals = 2 } = opts;

  let iterations = 0;
  let deletedIslands = 0;
  let deletedDeadLeaves = 0;
  const MAX_FINALS_TOTAL = 3; // TILE_INVENTORY.final.total = 3

  while (iterations++ < MAX_ITER) {
    const sizeBefore = tiles.size;
    const finalsBefore = countTilesByCategory(tiles, 'final');

    // ---------------- PASO 1: tiles con 0 connectors ----------------
    for (const [k, t] of Array.from(tiles.entries())) {
      if (t.category === 'inicio') continue;
      if (t.connectors.length === 0) {
        removeTileAndDisconnect(tiles, grid, usage, colorUsage, k);
      }
    }

    // ---------------- PASO 2: BORRAR ISLAS DESDE INICIO ----------------
    {
      const { reach } = bfsFromStart(tiles);
      const islands: string[] = [];
      for (const [k, t] of tiles.entries()) {
        if (t.category === 'inicio') continue;
        if (!reach.has(k)) islands.push(k);
      }
      // Primero borramos finales-isla antes que el resto
      islands.sort((a, b) => {
        const ta = tiles.get(a)?.category === 'final' ? 0 : 1;
        const tb = tiles.get(b)?.category === 'final' ? 0 : 1;
        return ta - tb;
      });
      for (const k of islands) {
        if (!tiles.has(k)) continue;
        deletedIslands++;
        removeTileAndDisconnect(tiles, grid, usage, colorUsage, k);
      }
    }

    // ---------------- PASO 3: HOJAS MUERTAS 1-connector ----------------
    {
      let progress = true;
      let guard = 0;
      while (progress && guard++ < 400) {
        progress = false;
        const leaves = Array.from(tiles.entries()).filter(([_, t]) =>
          t.connectors.length === 1 && t.category !== 'inicio' && t.category !== 'final'
        );
        if (!leaves.length) break;
        const { distance, start } = bfsFromStart(tiles);
        for (const [k, t] of leaves) {
          if (!tiles.has(k)) continue;
          const fCount = countTilesByCategory(tiles, 'final');
          const dist = getDistFallback(t, start || null, distance);
          const conn = t.connectors[0];
          if (
            fCount < desiredFinals &&
            dist >= minBranchLength &&
            (usage.final ?? 0) < MAX_FINALS_TOTAL
          ) {
            // Convertir hoja a final
            usage[t.category] = Math.max(0, (usage[t.category] ?? 0) - 1);
            if (COLOR_KEYS.includes(t.color as ColorName)) {
              if (!colorUsage[t.category]) colorUsage[t.category] = { rojo: 0, rosado: 0, amarillo: 0, azul: 0 };
              colorUsage[t.category][t.color as ColorName] = Math.max(0, (colorUsage[t.category][t.color as ColorName] ?? 0) - 1);
            }
            const finalTile: PlacedTile = {
              ...createEndTile(conn),
              x: t.x,
              y: t.y,
              pathStep: t.pathStep,
              branchId: t.branchId,
              parentStep: t.parentStep,
              connectors: [conn],
              rotation: 0,
            };
            tiles.set(k, finalTile);
            usage.final = (usage.final ?? 0) + 1;
            progress = true;
            continue;
          }
          // Borrar hoja muerta
          deletedDeadLeaves++;
          progress = true;
          removeTileAndDisconnect(tiles, grid, usage, colorUsage, k);
        }
      }
    }

    // ---------------- PASO 4: SOLO path.endCoords PUEDEN SER FINALES ----------------
    {
      const allowedKeys = new Set<string>();
      for (const ec of path.endCoords) {
        allowedKeys.add(kCoord(ec.x, ec.y));
      }

      // (a) Borrar finales no permitidos
      const finalsToDelete: string[] = [];
      for (const [k, t] of tiles.entries()) {
        if (t.category === 'final' && !allowedKeys.has(k)) {
          finalsToDelete.push(k);
        }
      }
      for (const k of finalsToDelete) {
        removeTileAndDisconnect(tiles, grid, usage, colorUsage, k);
      }

      // (b) Crear finales en endCoords si no existen
      for (const ec of path.endCoords) {
        const k = kCoord(ec.x, ec.y);
        const existing = tiles.get(k);
        const incoming = ('incoming' in ec && typeof ec.incoming === 'string' ? ec.incoming : 'west') as Direction;
        if (!existing || existing.category !== 'final') {
          if ((usage.final ?? 0) >= MAX_FINALS_TOTAL) break;
          if (existing) {
            usage[existing.category] = Math.max(0, (usage[existing.category] ?? 0) - 1);
            if (COLOR_KEYS.includes(existing.color as ColorName)) {
              if (!colorUsage[existing.category]) colorUsage[existing.category] = { rojo: 0, rosado: 0, amarillo: 0, azul: 0 };
              colorUsage[existing.category][existing.color as ColorName] = Math.max(0, (colorUsage[existing.category][existing.color as ColorName] ?? 0) - 1);
            }
          }
          const newFinal: PlacedTile = {
            ...createEndTile(incoming),
            x: ec.x,
            y: ec.y,
            pathStep: existing?.pathStep ?? 0,
            branchId: existing?.branchId ?? 0,
            parentStep: existing?.parentStep ?? null,
            connectors: [incoming],
            rotation: 0,
          };
          tiles.set(k, newFinal);
          usage.final = (usage.final ?? 0) + 1;
        }

        // (c) Recíproco en vecino
        const dx = DIR_DELTA[incoming].dx;
        const dy = DIR_DELTA[incoming].dy;
        const nk = kCoord(ec.x + dx, ec.y + dy);
        const neighbor = tiles.get(nk);
        if (neighbor && neighbor.category !== 'final') {
          const expectedBack = OPPOSITE_DIR[incoming];
          if (!neighbor.connectors.includes(expectedBack)) {
            const nb: Direction[] = [...neighbor.connectors, expectedBack];
            const oldCat = neighbor.category;
            const oldColor = neighbor.color;
            usage[oldCat] = Math.max(0, (usage[oldCat] ?? 0) - 1);
            if (COLOR_KEYS.includes(oldColor as ColorName)) {
              if (!colorUsage[oldCat]) colorUsage[oldCat] = { rojo: 0, rosado: 0, amarillo: 0, azul: 0 };
              colorUsage[oldCat][oldColor as ColorName] = Math.max(0, (colorUsage[oldCat][oldColor as ColorName] ?? 0) - 1);
            }
            const needsCurve =
              nb.length === 2 &&
              (nb.includes('north') || nb.includes('south')) &&
              (nb.includes('east') || nb.includes('west')) &&
              !(nb.includes('north') && nb.includes('south')) &&
              !(nb.includes('east') && nb.includes('west'));
            const newShape: TileShape =
              nb.length === 3 ? 'intersection3' :
              nb.length >= 4 ? 'intersection4' :
              needsCurve ? 'curve' : 'straight';
            const newCat: TileCategory = newShape === 'intersection3' || newShape === 'intersection4' ? 'desvio' : needsCurve ? 'curve' : 'normal';
            const step = typeof neighbor.pathStep === 'number' ? neighbor.pathStep : 0;
            const color: TileColor = newShape === 'intersection3' || newShape === 'intersection4' ? 'neutral' : COLOR_CYCLE[step % 4];
            const repl = createTileFromCategory(newCat, color, newShape, nb, neighbor.rotation ?? 0, false);
            if (repl) {
              const tNext: PlacedTile = {
                ...repl,
                x: neighbor.x,
                y: neighbor.y,
                pathStep: neighbor.pathStep,
                branchId: neighbor.branchId,
                parentStep: neighbor.parentStep,
              };
              tiles.set(nk, tNext);
              usage[tNext.category] = (usage[tNext.category] ?? 0) + 1;
              if (COLOR_KEYS.includes(tNext.color as ColorName)) {
                if (!colorUsage[tNext.category]) colorUsage[tNext.category] = { rojo: 0, rosado: 0, amarillo: 0, azul: 0 };
                colorUsage[tNext.category][tNext.color as ColorName] = (colorUsage[tNext.category][tNext.color as ColorName] ?? 0) + 1;
              }
            } else {
              neighbor.connectors = nb;
            }
          }
        }
        }
      }
    const sizeAfter = tiles.size;
    const finalsAfter = countTilesByCategory(tiles, 'final');
    if (sizeAfter === sizeBefore && finalsAfter === finalsBefore) break;
  }

  return {
    tiles,
    finalsCount: countTilesByCategory(tiles, 'final'),
    iterations,
    deletedIslands,
    deletedDeadLeaves,
  };
}
