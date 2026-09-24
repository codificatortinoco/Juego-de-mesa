/**
 * Asignación de colores siguiendo el patrón periódico ROJO → ROSADO → AMARILLO → AZUL.
 *
 * Reglas:
 * - El color se determina por la posición en el recorrido (pathStep).
 * - Losetas neutrales (Inicio, Final, Desvíos, 2Estrellas) NO incrementan el contador.
 * - En una bifurcación, cada nueva rama continúa la secuencia a partir del paso de la intersección.
 */
import { COLOR_CYCLE, getColorForStep, type Direction } from '../data/tiles';
import { DIR_DELTA } from '../data/tiles';
import type { PathResult } from './generatePath';
import type { TileColor } from '../data/assetMap';

export interface ColorAssignment {
  color: TileColor;
  effectiveStep: number;
}

/**
 * Recorre el grafo de pasos y asigna colores teniendo en cuenta:
 * - Inicio y Final son neutrales.
 * - Intersecciones (desvíos) son neutrales y susceden a la misma cuenta.
 * - Cada rama suma a partir del offset de color de la rama.
 */
export function assignColorsToPath(
  pathResult: PathResult,
  patternStartOffset: number = 0
): Map<string, ColorAssignment> {
  const assignments = new Map<string, ColorAssignment>();
  const { grid, startCoord, branchColorOffsets, stepToCoord } = pathResult;

  const safeOffset = Math.max(0, Math.min(3, Math.floor(patternStartOffset) || 0));
  const visitedBranches = new Set<number>();

  function effectiveStepForBranch(branchId: number, localIndex: number): number {
    const branchStart = branchColorOffsets.get(branchId) ?? 0;
    return branchStart + localIndex;
  }

  const branchLocalCounters = new Map<number, number>();

  const startKey = `${startCoord.x},${startCoord.y}`;
  assignments.set(startKey, {
    color: 'neutral',
    effectiveStep: 0,
  });
  branchLocalCounters.set(0, safeOffset);

  const startCell = grid.get(startKey);
  if (!startCell) return assignments;

  const queue: { x: number; y: number; fromDir: Direction | null }[] = [];
  for (const dir of startCell.outgoing) {
    queue.push({
      x: startCoord.x + DIR_DELTA[dir].dx,
      y: startCoord.y + DIR_DELTA[dir].dy,
      fromDir: dir,
    });
  }

  const processed = new Set<string>([startKey]);
  let guard = 0;

  while (queue.length > 0 && guard < grid.size * 4) {
    guard++;
    const item = queue.shift()!;
    const key = `${item.x},${item.y}`;
    if (processed.has(key)) continue;
    processed.add(key);

    const cell = grid.get(key);
    if (!cell) continue;

    const branchId = cell.branchId;
    let localCount = branchLocalCounters.get(branchId) ?? -1;

    if (cell.isEnd) {
      assignments.set(key, { color: 'neutral', effectiveStep: cell.pathStep });
    } else if (cell.isIntersection) {
      assignments.set(key, { color: 'neutral', effectiveStep: cell.pathStep });
      visitedBranches.add(branchId);
      if (localCount < 0) {
        const parentKey = cell.parentStep != null
          ? (() => {
              const p = stepToCoord.get(cell.parentStep);
              return p ? `${p.x},${p.y}` : null;
            })()
          : null;
        const parentAssignment = parentKey ? assignments.get(parentKey) : null;
        const baseStep = parentAssignment?.effectiveStep ?? cell.pathStep;
        branchLocalCounters.set(branchId, baseStep + 1);
        localCount = baseStep + 1;
      }
    } else {
      if (localCount < 0) {
        const parentKey = cell.parentStep != null
          ? (() => {
              const p = stepToCoord.get(cell.parentStep);
              return p ? `${p.x},${p.y}` : null;
            })()
          : null;
        const parentAssignment = parentKey ? assignments.get(parentKey) : null;
        let startStep = 0;
        if (parentAssignment && parentAssignment.color !== 'neutral') {
          startStep = (parentAssignment.effectiveStep % 4) + 1;
        } else if (parentAssignment) {
          const found = findLastColoredAncestor(cell, assignments, pathResult);
          startStep = found != null ? (found % 4) + 1 : 1 + safeOffset;
        } else {
          startStep = safeOffset;
        }
        branchLocalCounters.set(branchId, startStep);
        localCount = startStep;
      }

      void effectiveStepForBranch(branchId, 0);
      const actualStep = localCount;
      const color = getColorForStep(actualStep);
      assignments.set(key, { color, effectiveStep: actualStep });
      branchLocalCounters.set(branchId, localCount + 1);
    }

    for (const dir of cell.outgoing) {
      const nx = cell.x + DIR_DELTA[dir].dx;
      const ny = cell.y + DIR_DELTA[dir].dy;
      const nkey = `${nx},${ny}`;
      if (!processed.has(nkey) && grid.has(nkey)) {
        queue.push({ x: nx, y: ny, fromDir: dir });
      }
    }
  }

  for (const [key, cell] of grid) {
    if (!assignments.has(key)) {
      if (cell.isStart) {
        assignments.set(key, { color: 'neutral', effectiveStep: 0 });
      } else if (cell.isEnd) {
        assignments.set(key, { color: 'neutral', effectiveStep: cell.pathStep });
      } else if (cell.isIntersection) {
        assignments.set(key, { color: 'neutral', effectiveStep: cell.pathStep });
      } else {
        assignments.set(key, {
          color: COLOR_CYCLE[(safeOffset + cell.pathStep) % 4],
          effectiveStep: safeOffset + cell.pathStep,
        });
      }
    }
  }

  return assignments;
}

function findLastColoredAncestor(
  cell: { parentStep: number | null; branchId: number; pathStep: number },
  assignments: Map<string, ColorAssignment>,
  pathResult: PathResult
): number | null {
  let cursor = cell.parentStep;
  let safety = 0;
  while (cursor != null && safety < 40) {
    safety++;
    const coord = pathResult.stepToCoord.get(cursor);
    if (!coord) break;
    const key = `${coord.x},${coord.y}`;
    const a = assignments.get(key);
    if (a && a.color !== 'neutral') {
      return a.effectiveStep;
    }
    const c = pathResult.grid.get(key);
    cursor = c?.parentStep ?? null;
  }
  return null;
}
