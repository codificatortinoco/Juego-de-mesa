import type { Direction } from '../data/tiles';
import { DIR_DELTA, OPPOSITE_DIR } from '../data/tiles';
import type { GridCell } from './generatePath';

function coordKeyLocal(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Pre-cleanup: Si no se permiten intersecciones de 4 direcciones, transforma
 * I4 a I3 de forma segura conservando el tronco (incoming) y actualizando
 * vecinos recíprocos en punto fijo.
 */
export function preTransformI4ToI3(
  grid: Map<string, GridCell>,
  startCoord: { x: number; y: number },
  allow4WayIntersection: boolean
): void {
  if (allow4WayIntersection) return;

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
      if (
        cell.x === startCoord.x + 1 &&
        cell.y === startCoord.y &&
        !origDirs.includes('west')
      ) {
        origDirs.push('west');
      }
      if (origDirs.length < 3) continue;

      // Paso 1: reducir a 3 direcciones cortando la 4ª (si hay 4)
      while (origDirs.length > 3) origDirs.pop();

      // Conservar incoming (tronco) si existe en origDirs
      let inc: Direction | null = cell.incoming;
      if (!inc || !origDirs.includes(inc)) inc = origDirs[0];
      const outs = origDirs.filter((d: Direction) => d !== inc);

      // Calcular removedDir (dirección de la rama que SE ELIMINA)
      const allFull: Direction[] = [];
      for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
        const { dx, dy } = DIR_DELTA[d];
        const had =
          grid.has(coordKeyLocal(cell.x + dx, cell.y + dy)) ||
          (cell.x === startCoord.x + 1 && cell.y === startCoord.y && d === 'west');
        if (had) allFull.push(d);
      }
      let remDir: Direction | null = null;
      for (const d of allFull) {
        if (!origDirs.includes(d)) {
          remDir = d;
          break;
        }
      }
      if (!remDir) {
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
          if (
            nCell.x === startCoord.x + 1 &&
            nCell.y === startCoord.y &&
            !nLoc.includes('west')
          ) {
            nLoc.push('west');
          }
          if (nLoc.length === 0) {
            nCell.incoming = null;
            nCell.outgoing = [];
            nCell.numConnectors = 0;
            nCell.isIntersection = false;
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

    // Cascade <2 vecinos con protección en torno al Inicio
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
        if (
          Math.abs(cell.x - (startCoord.x + 1)) + Math.abs(cell.y - startCoord.y) <= 2 ||
          Math.abs(cell.x - startCoord.x) + Math.abs(cell.y - startCoord.y) <= 2
        ) {
          isAdjStart = true;
        }
        if (
          cell.y === startCoord.y &&
          (cell.x === startCoord.x + 1 || cell.x === startCoord.x + 2 || cell.x === startCoord.x + 3)
        ) {
          isAdjStart = true;
        }
        if (isAdjStart || isAdjEnd) continue;

        const nb: Direction[] = [];
        for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
          const { dx, dy } = DIR_DELTA[d];
          if (grid.has(coordKeyLocal(cell.x + dx, cell.y + dy))) nb.push(d);
        }
        if (
          cell.x === startCoord.x + 1 &&
          cell.y === startCoord.y &&
          !nb.includes('west')
        ) {
          nb.push('west');
        }
        if (nb.length < 2) {
          delCells.push(coordKeyLocal(cell.x, cell.y));
          casc = true;
          preChanged = true;
        }
      }
      for (const k of delCells) grid.delete(k);
      delCells.length = 0;
    }

    // Validar conectores
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
        cell.incoming = null;
        cell.numConnectors = 1;
        cell.isIntersection = false;
        continue;
      }
      if (cell.isEnd) {
        cell.outgoing = [];
        let inc = cell.incoming;
        if (!inc || !validDirs.has(inc)) {
          inc = null;
          for (const d of ['west', 'north', 'east', 'south'] as Direction[]) {
            if (validDirs.has(d)) {
              inc = d;
              break;
            }
          }
        }
        cell.incoming = inc;
        cell.numConnectors = inc ? 1 : 0;
        cell.isIntersection = false;
        continue;
      }

      const validated = new Set<Direction>();
      if (cell.incoming && validDirs.has(cell.incoming)) validated.add(cell.incoming);
      for (const od of cell.outgoing) {
        if (validDirs.has(od)) validated.add(od);
      }
      if (validated.size === 0) {
        if (validDirs.size === 0) {
          cell.incoming = null;
          cell.outgoing = [];
          cell.numConnectors = 0;
          cell.isIntersection = false;
          continue;
        }
        const arr = [...validDirs];
        cell.incoming = arr[0];
        cell.outgoing = arr.slice(1);
        cell.numConnectors = arr.length;
      } else {
        const prefInc =
          cell.incoming && validated.has(cell.incoming)
            ? cell.incoming
            : [...validated][0];
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
