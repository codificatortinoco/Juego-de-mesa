import type { Direction } from '../data/tiles';
import { DIR_DELTA, OPPOSITE_DIR } from '../data/tiles';
import type { GridCell } from './generatePath';

/**
 * Calcula qué celdas (no intersección, ni start/end) caen dentro de la
 * rama más corta desde una intersección hasta cualquier Final.
 * Estas celdas se priorizan para aplicar penalizaciones (Cárcel, Tragamonedas, Retroceder).
 */
export function findShortBranchCells(
  grid: Map<string, GridCell>,
  startCoord: { x: number; y: number },
  endCoords: { x: number; y: number }[]
): Set<string> {
  const shortBranchSet = new Set<string>();
  const ckey = (x: number, y: number): string => `${x},${y}`;

  // PASO 1: BFS inverso desde TODOS los finales → distToAnyEnd[k] = pasos mínimos hasta cualquier final.
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

    for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
      let dx = DIR_DELTA[d].dx;
      const dy = DIR_DELTA[d].dy;
      if (curT.isStart && d === 'east') dx = 2;
      const nx = curT.x + dx;
      const ny = curT.y + dy;
      const nk = ckey(nx, ny);

      if (!distToAnyEnd.has(nk) && grid.has(nk)) {
        distToAnyEnd.set(nk, cur.d + 1);
        queueRev.push({ k: nk, d: cur.d + 1 });
        continue;
      }

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
  const shortMark = new Map<string, boolean>();
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

    const connDirs = new Set<Direction>();
    if (curT.incoming) connDirs.add(curT.incoming);
    for (const o of curT.outgoing) connDirs.add(o);

    if (connDirs.size === 0 || curT.isIntersection) {
      for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
        const { dx, dy } = DIR_DELTA[d];
        const nx = curT.x + dx;
        const ny = curT.y + dy;
        const nk = ckey(nx, ny);
        if (grid.has(nk)) connDirs.add(d);
      }
    }

    if (curT.isStart) {
      connDirs.delete('east');
      const far = ckey(curT.x + 2, curT.y);
      if (grid.has(far)) connDirs.add('east');
    }

    const outDirs: Direction[] = [];
    for (const d of connDirs) {
      if (cur.parentDir != null && d === cur.parentDir) continue;
      outDirs.push(d);
    }
    if (curT.isStart && outDirs.length === 0) outDirs.push('east');

    let isIntersectionNow = false;
    const bocaShort = new Set<Direction>();
    if (!curT.isStart && !curT.isEnd && curT.numConnectors >= 3 && curT.isIntersection) {
      isIntersectionNow = true;
      const bocas: { d: Direction; dist: number }[] = [];
      for (const d of outDirs) {
        let dx = DIR_DELTA[d].dx;
        const dy = DIR_DELTA[d].dy;
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

    for (const d of outDirs) {
      let dx = DIR_DELTA[d].dx;
      const dy = DIR_DELTA[d].dy;
      if (curT.isStart && d === 'east') dx = 2;
      const nx = curT.x + dx;
      const ny = curT.y + dy;
      const nk = ckey(nx, ny);
      const neigh = grid.get(nk);
      if (!neigh || visitedFwd.has(nk)) continue;

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

  return shortBranchSet;
}
