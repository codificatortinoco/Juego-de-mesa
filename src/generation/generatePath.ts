/**
 * Generación de la estructura de rutas sobre una cuadrícula.
 *
 * Estrategia SIMPLE (modo MVP):
 * 1. Colocar Inicio 2×1 en un punto central.
 * 2. Primera loseta del camino se coloca MANUALMENTE en (startX+2, startY),
 *    saltando la segunda celda visual del Inicio 2×1.
 * 3. Un único head avanza de 1 en 1 celda, gira ocasionalmente,
 *    SIN bifurcaciones (0 desvíos).
 * 4. Cuando no puede avanzar más o alcanza longitud mínima, cierra con 1 Final.
 * 5. Limpieza CONSERVADORA: SOLO se eliminan conexiones a celdas inexistentes,
 *    NUNCA se añaden conexiones nuevas a vecinos (evita caminos huérfanos).
 */
import type { Direction } from '../data/tiles';
import {
  DIRECTIONS,
  DIR_DELTA,
  OPPOSITE_DIR,
} from '../data/tiles';
import type { SeededRandom } from './seededRandom';

export interface GridCell {
  x: number;
  y: number;
  incoming: Direction | null;
  outgoing: Direction[];
  pathStep: number;
  branchId: number;
  parentStep: number | null;
  isStart: boolean;
  isEnd: boolean;
  isIntersection: boolean;
  numConnectors: number;
}

export interface PathResult {
  grid: Map<string, GridCell>;
  width: number;
  height: number;
  startCoord: { x: number; y: number };
  endCoords: { x: number; y: number }[];
  branches: number;
  maxStep: number;
  stepToCoord: Map<number, { x: number; y: number; branchId: number }>;
  coordToStep: Map<string, number>;
  branchColorOffsets: Map<number, number>;
}

function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}

function cellIsOccupied(
  key: string,
  grid: Map<string, GridCell>,
  startOcc: Set<string>
): boolean {
  return grid.has(key) || startOcc.has(key);
}

function getFreeDirections(
  x: number,
  y: number,
  grid: Map<string, GridCell>,
  startOcc: Set<string>,
  width: number,
  height: number,
  extraPad: number = 1
): Direction[] {
  const result: Direction[] = [];
  for (const dir of DIRECTIONS) {
    const { dx, dy } = DIR_DELTA[dir];
    const nx = x + dx;
    const ny = y + dy;
    if (
      nx >= extraPad &&
      nx < width - extraPad &&
      ny >= extraPad &&
      ny < height - extraPad &&
      !cellIsOccupied(coordKey(nx, ny), grid, startOcc)
    ) {
      result.push(dir);
    }
  }
  return result;
}


interface GeneratePathOptions {
  rng: SeededRandom;
  gridWidth?: number;
  gridHeight?: number;
  maxTiles?: number;
  desiredFinals?: number;
  desvioBudget?: number;
  minBranchLength?: number;
  turnProbability?: number;
  intersectionProbability?: number;
  allow4WayIntersection?: boolean;
}

/**
 * Genera la estructura de rutas (solo geometría, sin colores ni categorías).
 */
export function generatePathStructure(
  opts: GeneratePathOptions
): PathResult {
  const {
    rng,
    gridWidth = 14,
    gridHeight = 14,
    maxTiles = 36,
    desiredFinals = 1,
    desvioBudget = 0,
    minBranchLength = 8,
    turnProbability = 0.22,
    intersectionProbability = 0,
    allow4WayIntersection = false,
  } = opts;

  const grid = new Map<string, GridCell>();
  const stepToCoord = new Map<
    number,
    { x: number; y: number; branchId: number }
  >();
  const coordToStep = new Map<string, number>();
  const branchColorOffsets = new Map<number, number>();

  const startX = Math.max(2, Math.min(gridWidth - 5, Math.floor(gridWidth / 2) - 1));
  const startY = Math.max(2, Math.min(gridHeight - 3, Math.floor(gridHeight / 2)));

  const startDir: Direction = 'east';
  const startKey = coordKey(startX, startY);
  let nextStep = 0;

  // --- [1] Colocar Inicio 2×1 ---
  grid.set(startKey, {
    x: startX,
    y: startY,
    incoming: null,
    outgoing: [startDir],
    pathStep: nextStep,
    branchId: 0,
    parentStep: null,
    isStart: true,
    isEnd: false,
    isIntersection: false,
    numConnectors: 1,
  });
  stepToCoord.set(nextStep, { x: startX, y: startY, branchId: 0 });
  coordToStep.set(startKey, nextStep);
  branchColorOffsets.set(0, 0);
  nextStep++;

  // startOccupancy: las DOS celdas visuales del Inicio 2×1.
  // NO bloquea startX+2 → esa es la primera celda del camino.
  const startOccupancy = new Set<string>();
  startOccupancy.add(coordKey(startX, startY));
  startOccupancy.add(coordKey(startX + 1, startY));

  // --- [2] Colocar PRIMERA CELDA DEL CAMINO manualmente en startX+2, startY ---
  // Inicio ocupa cols startX y startX+1 → la salida está a dx=2.
  const firstX = startX + 2;
  const firstY = startY;
  const firstKey = coordKey(firstX, firstY);

  const maxIterations = maxTiles * 4;
  const endCoords: { x: number; y: number }[] = [];

  // Comprobación de seguridad: si la primera celda está ocupada (no debería), rendirse ya
  if (cellIsOccupied(firstKey, grid, startOccupancy) ||
      firstX < 1 || firstX >= gridWidth - 1 || firstY < 1 || firstY >= gridHeight - 1) {
    // Mapa no válido: devolver grid con start sin final
    return {
      grid,
      width: gridWidth,
      height: gridHeight,
      startCoord: { x: startX, y: startY },
      endCoords: [],
      branches: 1,
      maxStep: nextStep - 1,
      stepToCoord,
      coordToStep,
      branchColorOffsets,
    };
  }

  // Colocar primera celda: incoming = west (desde el Start),
  // outgoing lo decidiremos en la primera iteración del loop
  const firstCell: GridCell = {
    x: firstX,
    y: firstY,
    incoming: 'west',
    outgoing: [],
    pathStep: nextStep,
    branchId: 0,
    parentStep: 0,
    isStart: false,
    isEnd: false,
    isIntersection: false,
    numConnectors: 1,
  };

  // Decidir la dirección de salida de la primera celda
  const firstFreeDirs = getFreeDirections(firstX, firstY, grid, startOccupancy, gridWidth, gridHeight);
  const firstUsable = firstFreeDirs.filter((d) => d !== 'west'); // west es incoming
  let initialOutDir: Direction;
  if (firstUsable.includes('east') && !rng.chance(turnProbability)) {
    initialOutDir = 'east';
  } else if (firstUsable.length > 0) {
    initialOutDir = rng.pick(firstUsable);
  } else {
    // Sin salida: directamente hacemos esta celda = Final
    firstCell.isEnd = true;
    firstCell.outgoing = [];
    firstCell.numConnectors = 1;
    grid.set(firstKey, firstCell);
    stepToCoord.set(nextStep, { x: firstX, y: firstY, branchId: 0 });
    coordToStep.set(firstKey, nextStep);
    nextStep++;
    endCoords.push({ x: firstX, y: firstY });
    return {
      grid,
      width: gridWidth,
      height: gridHeight,
      startCoord: { x: startX, y: startY },
      endCoords,
      branches: 1,
      maxStep: nextStep - 1,
      stepToCoord,
      coordToStep,
      branchColorOffsets,
    };
  }
  firstCell.outgoing.push(initialOutDir);
  firstCell.numConnectors++;
  grid.set(firstKey, firstCell);
  stepToCoord.set(nextStep, { x: firstX, y: firstY, branchId: 0 });
  coordToStep.set(firstKey, nextStep);
  nextStep++;

  // Actualizar Start: outgoing=[east] ya lo tiene desde el constructor.
  // initialOutDir lo usamos para la dirección de salida del head inicial.

  let iter = 0;
  let finalsPlaced = 0;
  let usedDesvios = 0;
  let nextBranchId = 1;

  interface ActiveHead {
    x: number;
    y: number;
    prevDir: Direction;
    length: number;
    branchId: number;
    alive: boolean;
  }

  const heads: ActiveHead[] = [
    { x: firstX, y: firstY, prevDir: initialOutDir, length: 1, branchId: 0, alive: true },
  ];

  function firstAliveHead(): ActiveHead | null {
    return heads.find((h) => h.alive) ?? null;
  }

  // --- [3] Loop: avanzar heads activos hasta que no quede ninguno ---
  while (
    grid.size < maxTiles &&
    iter < maxIterations &&
    finalsPlaced < desiredFinals
  ) {
    iter++;
    const head = firstAliveHead();
    if (!head) break;

    const headKey = coordKey(head.x, head.y);
    const { dx, dy } = DIR_DELTA[head.prevDir];
    const nextX = head.x + dx;
    const nextY = head.y + dy;
    const nextKey = coordKey(nextX, nextY);

    const canAdvance =
      nextX >= 1 && nextX < gridWidth - 1 &&
      nextY >= 1 && nextY < gridHeight - 1 &&
      !cellIsOccupied(nextKey, grid, startOccupancy);

    if (!canAdvance) {
      // No se puede seguir avanzando en prevDir. Intentar girar / bifurcar.
      const freeNow = getFreeDirections(head.x, head.y, grid, startOccupancy, gridWidth, gridHeight);
      const headCell = grid.get(headKey)!;
      const options = freeNow.filter((d) => d !== headCell.incoming);

      // --- INTENTO BIFURCAR: hay presupuesto, options length >=2 y hay probabilidad ---
      const aliveCount = heads.filter(h => h.alive).length;
      // REGLA DURA Moderada: Intersection3 NUNCA usa NORTH (boca bloqueada por verde).
      // Si !allow4WayIntersection, descartamos north de las opciones antes de verificar length >=2.
      let bifurOptions = options;
      if (!allow4WayIntersection) {
        bifurOptions = options.filter((d) => d !== 'north');
      }
      const canBifurcar =
        usedDesvios < desvioBudget &&
        bifurOptions.length >= 2 &&
        finalsPlaced + aliveCount < desiredFinals + 3 &&
        head.length >= Math.max(4, Math.floor(minBranchLength / 3)) &&
        (rng.chance(intersectionProbability + 0.15) || (aliveCount === 1 && finalsPlaced === 0 && head.length >= 8 && usedDesvios < desvioBudget));

      if (canBifurcar) {
        const shuffled = [...bifurOptions];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = rng.range(0, i);
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const dirsToUse: Direction[] = shuffled.slice(0, 2);
        const [dirA, dirB] = dirsToUse;
        // HEAD de esta celda: se REEMPLAZA outgoing por dirA+dirB (NO headPrevDir antiguo, ya que no se pudo avanzar por él)
        headCell.outgoing = [dirA, dirB];
        headCell.numConnectors = (headCell.incoming ? 1 : 0) + 2;
        headCell.isIntersection = true;

        // Head actual continúa por dirA
        head.prevDir = dirA;

        // Crear NUEVO head para dirB como una nueva rama (nuevo branch)
        const newBranchId = nextBranchId++;
        branchColorOffsets.set(newBranchId, 0);
        heads.push({
          x: head.x,
          y: head.y,
          prevDir: dirB,
          length: head.length,
          branchId: newBranchId,
          alive: true,
        });
        usedDesvios++;
        continue;
      }

      if (options.length > 0) {
        // GIRO NORMAL (no bifurcación): reemplazamos outgoing (el headPrevDir original era inválido
        // porque canAdvance=false, así que NO debe quedar en outgoing → evitar falso intersection3).
        const newDir: Direction = rng.chance(turnProbability)
          ? rng.pick(options)
          : (options.includes(head.prevDir) ? head.prevDir : rng.pick(options));

        headCell.outgoing = [newDir];
        headCell.numConnectors = (headCell.incoming ? 1 : 0) + 1;
        head.prevDir = newDir;
        continue;
      }

      // No hay más giros. Colocar Final si longitud suficiente.
      const minLenThreshold = Math.min(minBranchLength, 15);
      if (head.length >= minLenThreshold && finalsPlaced < desiredFinals) {
        const hCell = grid.get(headKey)!;
        hCell.isEnd = true;
        hCell.outgoing = [];
        const allDirsForCount = new Set<Direction>();
        if (hCell.incoming) allDirsForCount.add(hCell.incoming);
        hCell.numConnectors = allDirsForCount.size;
        endCoords.push({ x: head.x, y: head.y });
        finalsPlaced++;
      }
      head.alive = false;
      continue;
    }

    // --- Podemos avanzar. Colocar nueva celda en (nextX, nextY). ---
    const incomingToNext = OPPOSITE_DIR[head.prevDir];
    const freeDirsNext = getFreeDirections(nextX, nextY, grid, startOccupancy, gridWidth, gridHeight);
    const usableNext = freeDirsNext.filter((d) => d !== incomingToNext);

    // REGLA DURA Moderada: Intersection3 NUNCA usa NORTH.
    let usableNextBifur = usableNext;
    if (!allow4WayIntersection) {
      usableNextBifur = usableNext.filter((d) => d !== 'north');
    }

    // ¿Bifurcar en la NUEVA celda que acabamos de colocar?
    const aliveCount2 = heads.filter(h => h.alive).length;
    const wantBifurcarEnNext =
      usedDesvios < desvioBudget &&
      usableNextBifur.length >= 2 &&
      finalsPlaced + aliveCount2 < desiredFinals + 3 &&
      head.length + 1 >= Math.max(4, Math.floor(minBranchLength / 3)) &&
      grid.size + 2 <= maxTiles - 2 &&
      (rng.chance(intersectionProbability + 0.1) || (aliveCount2 === 1 && finalsPlaced === 0 && head.length >= 10 && usedDesvios < desvioBudget));

    if (usableNext.length === 0) {
      // Nuevo esquina sin salida. Convertir en Final y terminar head.
      const lastCell: GridCell = {
        x: nextX,
        y: nextY,
        incoming: incomingToNext,
        outgoing: [],
        pathStep: nextStep,
        branchId: head.branchId,
        parentStep: coordToStep.get(headKey) ?? null,
        isStart: false,
        isEnd: true,
        isIntersection: false,
        numConnectors: 1,
      };
      grid.set(nextKey, lastCell);
      stepToCoord.set(nextStep, { x: nextX, y: nextY, branchId: head.branchId });
      coordToStep.set(nextKey, nextStep);
      nextStep++;

      const prevCell = grid.get(headKey)!;
      if (!prevCell.outgoing.includes(head.prevDir)) {
        prevCell.outgoing.push(head.prevDir);
        prevCell.numConnectors++;
      }

      endCoords.push({ x: nextX, y: nextY });
      finalsPlaced++;
      head.x = nextX; head.y = nextY; head.length++;
      head.alive = false;
      continue;
    }

    // Decidir dirección de salida
    // SI vamos a BIFURCAR en esta celda, ambos (nextOutDir y extraDir) deben elegirse de usableNextBifur
    // (Moderada: sin north, garantiza Intersection3 = [W,E,S] o similar sin norte)
    const dirsForNextOut = wantBifurcarEnNext ? usableNextBifur : usableNext;
    const goStraight = dirsForNextOut.includes(head.prevDir) && !rng.chance(turnProbability);
    let nextOutDir: Direction;
    if (goStraight) {
      nextOutDir = head.prevDir;
    } else {
      const turnOptions = dirsForNextOut.filter((d) => d !== head.prevDir);
      nextOutDir = turnOptions.length > 0 ? rng.pick(turnOptions) : rng.pick(dirsForNextOut);
    }

    // ¿Debemos terminar aquí y poner Final?
    const wantFinish =
      finalsPlaced < desiredFinals &&
      heads.filter(h => h.alive).length + finalsPlaced <= desiredFinals + 1 &&
      head.length >= minBranchLength &&
      grid.size >= 14 &&
      rng.chance(Math.min(0.06 + (head.length - minBranchLength) * 0.015, 0.28));

    if (wantFinish && !wantBifurcarEnNext) {
      // Colocamos Final en (nextX, nextY)
      const lastCell: GridCell = {
        x: nextX,
        y: nextY,
        incoming: incomingToNext,
        outgoing: [],
        pathStep: nextStep,
        branchId: head.branchId,
        parentStep: coordToStep.get(headKey) ?? null,
        isStart: false,
        isEnd: true,
        isIntersection: false,
        numConnectors: 1,
      };
      grid.set(nextKey, lastCell);
      stepToCoord.set(nextStep, { x: nextX, y: nextY, branchId: head.branchId });
      coordToStep.set(nextKey, nextStep);
      nextStep++;

      const prevCell = grid.get(headKey)!;
      if (!prevCell.outgoing.includes(head.prevDir)) {
        prevCell.outgoing.push(head.prevDir);
        prevCell.numConnectors++;
      }

      endCoords.push({ x: nextX, y: nextY });
      finalsPlaced++;
      head.x = nextX; head.y = nextY; head.length++;
      head.alive = false;
      continue;
    }

    // Colocar celda normal
    const outgoingDirs: Direction[] = [nextOutDir];
    let extraDirForBifurcation: Direction | null = null;

    if (wantBifurcarEnNext) {
      // REGLA DURA: extraDir también de usableNextBifur (Moderada sin north)
      const otherOptions = usableNextBifur.filter((d) => d !== nextOutDir);
      if (otherOptions.length > 0) {
        extraDirForBifurcation = rng.pick(otherOptions);
        outgoingDirs.push(extraDirForBifurcation);
      }
    }

    const newCell: GridCell = {
      x: nextX,
      y: nextY,
      incoming: incomingToNext,
      outgoing: outgoingDirs,
      pathStep: nextStep,
      branchId: head.branchId,
      parentStep: coordToStep.get(headKey) ?? null,
      isStart: false,
      isEnd: false,
      isIntersection: extraDirForBifurcation != null,
      numConnectors: 1 + outgoingDirs.length,
    };

    grid.set(nextKey, newCell);
    stepToCoord.set(nextStep, { x: nextX, y: nextY, branchId: head.branchId });
    coordToStep.set(nextKey, nextStep);
    nextStep++;

    // Registrar outgoing de celda cabeza anterior
    const prevCell = grid.get(headKey)!;
    if (!prevCell.outgoing.includes(head.prevDir)) {
      prevCell.outgoing.push(head.prevDir);
      prevCell.numConnectors++;
    }

    head.x = nextX;
    head.y = nextY;
    head.prevDir = nextOutDir;
    head.length++;

    // Si bifurcamos aquí: crear NUEVO head que salga por extraDir
    if (extraDirForBifurcation) {
      usedDesvios++;
      const newBranchId = nextBranchId++;
      branchColorOffsets.set(newBranchId, 0);
      heads.push({
        x: nextX,
        y: nextY,
        prevDir: extraDirForBifurcation,
        length: head.length,
        branchId: newBranchId,
        alive: true,
      });
    }
  }

  // Heads que siguen vivos después del loop → cerrarlos como Finales (si cabe) o descartar.
  const minThreshold = Math.min(minBranchLength, 15);
  for (const head of heads) {
    if (!head.alive) continue;
    const hKey = coordKey(head.x, head.y);
    if (finalsPlaced < desiredFinals) {
      const hCell = grid.get(hKey);
      // Sólo setear isEnd si la celda es verdadera HOJA: outgoing vacío (no parte del medio de una rama).
      if (hCell && !hCell.isStart && !hCell.isEnd && (hCell.outgoing?.length ?? 0) === 0 && head.length >= minThreshold) {
        hCell.isEnd = true;
        hCell.outgoing = [];
        const s = new Set<Direction>();
        if (hCell.incoming) s.add(hCell.incoming);
        hCell.numConnectors = s.size;
        endCoords.push({ x: head.x, y: head.y });
        finalsPlaced++;
      } else {
        head.alive = false;
      }
    } else {
      head.alive = false;
    }
  }

  // --- [4] Si faltan Finals, forzarlos SÓLO en HOJAS (outgoing.length===0) más alejadas de Start POR PATHSTEP (no Manhattan).
  // Regla CRÍTICA usuario: Final NUNCA puede quedar en el "medio de un camino" (celda con outgoing que continúa otra rama).
  while (finalsPlaced < desiredFinals) {
    const aliveHead = heads.find((h) => h.alive);
    if (aliveHead) {
      const hKey = coordKey(aliveHead.x, aliveHead.y);
      const hCell = grid.get(hKey);
      if (hCell && !hCell.isStart && !hCell.isEnd && (hCell.outgoing?.length ?? 0) === 0 && aliveHead.length >= minThreshold) {
        hCell.isEnd = true;
        hCell.outgoing = [];
        const countSet = new Set<Direction>();
        if (hCell.incoming) countSet.add(hCell.incoming);
        hCell.numConnectors = countSet.size;
        endCoords.push({ x: aliveHead.x, y: aliveHead.y });
        finalsPlaced++;
        aliveHead.alive = false;
        continue;
      } else {
        aliveHead.alive = false;
      }
    }
    // Buscar cualquier celda no-Start/no-End que sea HOJA y con pathStep MÁXIMO (más alejada en el recorrido REAL).
    let best: GridCell | null = null;
    let bestStep = -1;
    for (const c of grid.values()) {
      if (c.isStart || c.isEnd) continue;
      if ((c.outgoing?.length ?? 0) !== 0) continue; // debe ser HOJA (no continuar nada después)
      if (c.pathStep > bestStep && c.pathStep >= minThreshold) {
        bestStep = c.pathStep;
        best = c;
      }
    }
    if (best) {
      best.isEnd = true;
      best.outgoing = [];
      const cs = new Set<Direction>();
      if (best.incoming) cs.add(best.incoming);
      best.numConnectors = cs.size;
      endCoords.push({ x: best.x, y: best.y });
      finalsPlaced++;
    } else {
      break;
    }
  }

  // --- [5] Limpieza CONSERVADORA + ELIMINACIÓN CELDAS MUERTAS (cascada fixed-point) ---
  // Regla DURA isIntersection solo si numConnectors real post-limpieza === 3 o ===4.
  // Eliminación: si celda no es start/end y tiene <2 vecinos ocupados → borrar de grid
  // (sino quedan cuadrados sueltos sin loseta SVG). Repetir hasta estabilizar.
  // PROTECCIÓN ESPECIAL: NO borrar celdas adyacentes a startOccupancy (primera celda del recorrido)
  //                     ni celdas con vecino isEnd (última celda antes de la meta), ya que
  //                     su borrado dejaría Start/End con 0 conectores.
  let changed = true;
  let safety = 0;
  while (changed && safety++ < 30) {
    changed = false;
    const toDelete: string[] = [];
    for (const cell of grid.values()) {
      if (cell.isStart || cell.isEnd) continue;

      // --- Protecciones: no borrar si es adyacente a Start o End ---
      let protectedByStart = false;
      let protectedByEnd = false;
      for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
        const { dx, dy } = DIR_DELTA[d];
        const nk = coordKey(cell.x + dx, cell.y + dy);
        if (startOccupancy.has(nk)) protectedByStart = true;
        const nb = grid.get(nk);
        if (nb && nb.isEnd) protectedByEnd = true;
      }
      // Extra: proteger primeras 3 celdas de la fila del Start (ruta principal)
      if (cell.y === startY && (cell.x === startX + 2 || cell.x === startX + 3 || cell.x === startX + 4)) protectedByStart = true;
      // Extra: Manhattan ≤2 de startCoord también protegido
      if ((Math.abs(cell.x - startX) + Math.abs(cell.y - startY)) <= 2) protectedByStart = true;
      if ((Math.abs(cell.x - (startX + 1)) + Math.abs(cell.y - startY)) <= 2) protectedByStart = true;
      if (protectedByStart || protectedByEnd) continue;

      // REGLA DURA ANTI-CASCADA: Si la celda ya tiene asignado incoming y al menos 1 outgoing
      // (o numConnectors >= 2), forma parte real del path y NUNCA se borra.
      // El recuento de vecinos físicos en grid solo sirve para losetas SUELTAS (no parte del path).
      const pathConnectors =
        (cell.incoming ? 1 : 0) +
        (cell.outgoing?.length ?? 0);
      if ((cell.incoming && (cell.outgoing?.length ?? 0) >= 1) || cell.numConnectors >= 2 || pathConnectors >= 2) continue;
      // -----------------------------------------------------------

      const existingNeighborDirs: Direction[] = [];
      for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
        const { dx, dy } = DIR_DELTA[d];
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (grid.has(coordKey(nx, ny)) || startOccupancy.has(coordKey(nx, ny))) {
          existingNeighborDirs.push(d);
        }
      }

      // startCell: vecinos directos + el start offseteado 2 (inicio está 2 casillas más a la izquierda)
      if (cell.x === startX + 1 && cell.y === startY && !existingNeighborDirs.includes('west')) {
        existingNeighborDirs.push('west');
      }

      if (existingNeighborDirs.length < 2) {
        toDelete.push(coordKey(cell.x, cell.y));
        changed = true;
      }
    }
    for (const k of toDelete) grid.delete(k);

    // Ajustar finales si fueron borrados (por si acaso)
    for (let i = endCoords.length - 1; i >= 0; i--) {
      const ec = endCoords[i];
      if (!grid.has(coordKey(ec.x, ec.y)) && !startOccupancy.has(coordKey(ec.x, ec.y))) {
        endCoords.splice(i, 1);
      }
    }
  }

  // Vuelta final: VALIDACIÓN de numConnectors / incoming / outgoing.
  // ESTRATEGIA CORRECTA (no falsas I4): CONSERVAR los incoming/outgoing originales
  // que la generación del camino asignó. Solo ELIMINAR direcciones cuyos vecinos
  // hayan sido borrados. NUNCA añadir conectores por simple adyacencia en grid
  // (dos losetas vecinas NO están necesariamente conectadas por el SVG).
  for (const cell of grid.values()) {
    // Construir conjunto de direcciones VÁLIDAS (vecino existe)
    const validDirs = new Set<Direction>();
    for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
      const { dx, dy } = DIR_DELTA[d];
      const nk = coordKey(cell.x + dx, cell.y + dy);
      if (grid.has(nk) || startOccupancy.has(nk)) validDirs.add(d);
    }
    if (cell.x === startX + 1 && cell.y === startY) validDirs.add('west');

    if (cell.isStart) {
      const keepOut: Direction[] = cell.outgoing.filter((d) => d === 'east');
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
          if (validDirs.has(d)) { inc = d; break; }
        }
      }
      cell.incoming = inc;
      cell.numConnectors = inc ? 1 : 0;
      cell.isIntersection = false;
      continue;
    }

    // Validar incoming/outgoing originales contra validDirs.
    const validated = new Set<Direction>();
    if (cell.incoming && validDirs.has(cell.incoming)) validated.add(cell.incoming);
    for (const od of cell.outgoing) {
      if (validDirs.has(od)) validated.add(od);
    }

    if (validated.size === 0) {
      if (validDirs.size === 0) {
        cell.incoming = null; cell.outgoing = []; cell.numConnectors = 0; cell.isIntersection = false; continue;
      }
      // Fallback extremo: celda rota completamente, usar validDirs como último recurso
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

  // --- [5B] Transformación I4→I3 si !allow4WayIntersection. ---
  // ESTRATEGIA SEGURA:
  //   Para cada I4: conservar cell.incoming (dirección hacia el tronco/Start)
  //   y QUITAR SÓLO UNO de los 3 cell.outgoing (la última rama bifurcada).
  //   NUNCA se elimina incoming, por lo que NUNCA se corta la ruta principal desde Start.
  //   Posteriormente: actualizar vecino de la rama eliminada (reciprocidad) +
  //   cascada de celdas huérfanas + recálculo completo conectores. Fixed-point.
  if (!allow4WayIntersection) {
    let postChanged = true;
    let postSafety = 0;
    while (postChanged && postSafety++ < 20) {
      postChanged = false;
      const toDeleteCells: string[] = [];

      for (const cell of grid.values()) {
        if (cell.isStart || cell.isEnd) continue;
        if (cell.numConnectors !== 4) continue;

        // Asegurar que incoming y outgoing estén bien distribuidos (4 direcciones = 1 incoming + 3 outgoing)
        const allDirs4: Direction[] = [];
        for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
          const { dx, dy } = DIR_DELTA[d];
          const nx = cell.x + dx, ny = cell.y + dy;
          if (grid.has(coordKey(nx, ny)) || startOccupancy.has(coordKey(nx, ny))) {
            allDirs4.push(d);
          }
        }
        if (cell.x === startX + 1 && cell.y === startY && !allDirs4.includes('west')) allDirs4.push('west');
        if (allDirs4.length < 3) continue; // no puede ser I4 válido, saltar
        while (allDirs4.length > 3) allDirs4.pop(); // garantiza 3 exactamente → I3

        // Conservar SIEMPRE incoming si existe y está en la lista
        let keptIncoming: Direction | null = cell.incoming;
        if (!keptIncoming || !allDirs4.includes(keptIncoming)) keptIncoming = allDirs4[0];
        const keptOutgoing = allDirs4.filter((d) => d !== keptIncoming);
        // Dirección ELIMINADA (la que era el 4º conector extra)
        const origAll: Direction[] = ['north', 'east', 'south', 'west'];
        let removedDir: Direction | null = null;
        for (const d of origAll) {
          const { dx, dy } = DIR_DELTA[d];
          const nk = coordKey(cell.x + dx, cell.y + dy);
          const hadIt = (grid.has(nk) || startOccupancy.has(nk)) || (cell.x === startX + 1 && cell.y === startY && d === 'west');
          if (hadIt && !allDirs4.includes(d)) {
            removedDir = d; break;
          }
        }
        if (!removedDir) {
          // Fallback: eliminar el ÚLTIMO outgoing de los 3 (rama bifurcada, no incoming)
          const origFull: Direction[] = [];
          for (const d of origAll) {
            const { dx, dy } = DIR_DELTA[d];
            const nk = coordKey(cell.x + dx, cell.y + dy);
            const hadIt = (grid.has(nk) || startOccupancy.has(nk)) || (cell.x === startX + 1 && cell.y === startY && d === 'west');
            if (hadIt) origFull.push(d);
          }
          const removed = keptOutgoing.pop()!;
          keptOutgoing.length = Math.min(keptOutgoing.length, 2);
          removedDir = removed;
          // forzamos allDirs4 = keptIncoming + keptOutgoing (3)
          allDirs4.length = 0;
          allDirs4.push(keptIncoming);
          for (const oo of keptOutgoing) allDirs4.push(oo);
        }

        // Aplicar a la celda: 3 direcciones finales (1 incoming + 2 outgoing = I3)
        cell.incoming = keptIncoming;
        cell.outgoing = keptOutgoing.slice(0, 2);
        const sc1 = new Set<Direction>();
        if (cell.incoming) sc1.add(cell.incoming);
        for (const od of cell.outgoing) sc1.add(od);
        cell.numConnectors = sc1.size;
        cell.isIntersection = cell.numConnectors === 3 || cell.numConnectors === 4;
        postChanged = true;

        // 2. Actualizar vecino de la dirección ELIMINADA: quitar su conector recíproco
        if (removedDir) {
          const { dx, dy } = DIR_DELTA[removedDir];
          const neighKey = coordKey(cell.x + dx, cell.y + dy);
          const neighCell = grid.get(neighKey);
          if (neighCell && !neighCell.isStart && !neighCell.isEnd) {
            const reciprocal = OPPOSITE_DIR[removedDir]; // al vecino le quitamos la dirección contraria
            const nLocal: Direction[] = [];
            for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
              if (d === reciprocal) continue;
              const { dx: ndx, dy: ndy } = DIR_DELTA[d];
              const nx = neighCell.x + ndx, ny = neighCell.y + ndy;
              if (grid.has(coordKey(nx, ny)) || startOccupancy.has(coordKey(nx, ny))) {
                nLocal.push(d);
              }
            }
            if (neighCell.x === startX + 1 && neighCell.y === startY && !nLocal.includes('west')) nLocal.push('west');
            if (nLocal.length === 0) {
              neighCell.incoming = null; neighCell.outgoing = []; neighCell.numConnectors = 0; neighCell.isIntersection = false;
            } else {
              if (neighCell.incoming && nLocal.includes(neighCell.incoming)) {
                neighCell.outgoing = nLocal.filter((d) => d !== neighCell.incoming);
              } else {
                neighCell.incoming = nLocal[0];
                neighCell.outgoing = nLocal.slice(1);
              }
              const scn = new Set<Direction>();
              if (neighCell.incoming) scn.add(neighCell.incoming);
              for (const od of neighCell.outgoing) scn.add(od);
              neighCell.numConnectors = scn.size;
              neighCell.isIntersection = neighCell.numConnectors === 3 || neighCell.numConnectors === 4;
            }
            postChanged = true;
          }
        }
      }

      // 3. cascade: borrar celdas no-start/no-end con <2 vecinos ocupados
      // PROTECCIÓN EXTRA FUERTE: NO borrar si adyacente a startOccupancy, isEnd,
      //   o es la 1ª/2ª celda del camino (x = startX+1, startX+2).
      let casc = true;
      let cs = 0;
      while (casc && cs++ < 30) {
        casc = false;
        for (const cell of grid.values()) {
          if (cell.isStart || cell.isEnd) continue;

          let isAdjacentToStart = false;
          let isAdjacentToEnd = false;
          for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
            const { dx, dy } = DIR_DELTA[d];
            const nk = coordKey(cell.x + dx, cell.y + dy);
            if (startOccupancy.has(nk)) isAdjacentToStart = true;
            const neighbor = grid.get(nk);
            if (neighbor && neighbor.isEnd) isAdjacentToEnd = true;
          }
          // Protección extra: primera y segunda celda del recorrido (x+1, x+2 desde startX en misma fila)
          if (cell.y === startY && (cell.x === startX + 1 || cell.x === startX + 2 || cell.x === startX + 3)) isAdjacentToStart = true;
          if (isAdjacentToStart || isAdjacentToEnd) continue;

          const nb: Direction[] = [];
          for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
            const { dx, dy } = DIR_DELTA[d];
            const k = coordKey(cell.x + dx, cell.y + dy);
            if (grid.has(k) || startOccupancy.has(k)) nb.push(d);
          }
          if (cell.x === startX + 1 && cell.y === startY && !nb.includes('west')) nb.push('west');
          if (nb.length < 2) { toDeleteCells.push(coordKey(cell.x, cell.y)); casc = true; postChanged = true; }
        }
        for (const k of toDeleteCells) grid.delete(k);
        toDeleteCells.length = 0;
      }

      // 4. VALIDAR conectores en todas las celdas después de borrados.
      // (Misma estrategia que el recálculo principal: conservar incoming/outgoing
      //  originales; solo eliminar direcciones cuyos vecinos faltan.)
      for (const cell of grid.values()) {
        const validDirs = new Set<Direction>();
        for (const d of ['north', 'east', 'south', 'west'] as Direction[]) {
          const { dx, dy } = DIR_DELTA[d];
          const k = coordKey(cell.x + dx, cell.y + dy);
          if (grid.has(k) || startOccupancy.has(k)) validDirs.add(d);
        }
        if (cell.x === startX + 1 && cell.y === startY) validDirs.add('west');

        if (cell.isStart) {
          const keepOut = cell.outgoing.filter((d) => d === 'east');
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
              if (validDirs.has(d)) { inc = d; break; }
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

  // --- [6] Validar distancia mínima Start→Final; filtrar finales demasiado cercanos ---
  const filteredEnds = endCoords.filter(
    (c) => Math.abs(c.x - startX) + Math.abs(c.y - startY) >= 3
  );
  const finalEnds = filteredEnds.length >= desiredFinals
    ? filteredEnds.slice(0, desiredFinals)
    : (filteredEnds.length > 0 ? filteredEnds : (endCoords.length > 0 ? endCoords.slice(0, desiredFinals) : []));
  for (const cell of grid.values()) {
    if (cell.isEnd && !finalEnds.some((e) => e.x === cell.x && e.y === cell.y)) {
      cell.isEnd = false;
    }
  }

  // --- [7] PODA RIGUROSA DE RAMAS MUERTAS (Backward Reachability desde los Finales) ---
  // Garantía absoluta: CUALQUIER celda que no tenga un camino dirigido hacia alguno de los
  // finalEnds es eliminada completamente del grafo. Si un desvío pierde una rama y queda
  // con solo 1 salida, se revierte a celda normal (no-intersección).
  const reachableFromFinal = new Set<string>();
  const revQ: string[] = [];
  for (const fe of finalEnds) {
    const k = coordKey(fe.x, fe.y);
    reachableFromFinal.add(k);
    revQ.push(k);
  }

  while (revQ.length > 0) {
    const currKey = revQ.shift()!;
    for (const [pk, pCell] of grid.entries()) {
      if (reachableFromFinal.has(pk)) continue;
      for (const od of pCell.outgoing) {
        let dx = DIR_DELTA[od].dx;
        const dy = DIR_DELTA[od].dy;
        if (pCell.isStart && od === 'east') dx = 2;
        if (coordKey(pCell.x + dx, pCell.y + dy) === currKey) {
          reachableFromFinal.add(pk);
          revQ.push(pk);
          break;
        }
      }
    }
  }

  reachableFromFinal.add(coordKey(startX, startY));

  // Eliminar celdas que no llevan a ningún final
  for (const [k, cell] of Array.from(grid.entries())) {
    if (!reachableFromFinal.has(k) && !cell.isStart) {
      grid.delete(k);
      coordToStep.delete(k);
    }
  }

  // Sincronizar stepToCoord
  for (const [step, coord] of Array.from(stepToCoord.entries())) {
    const k = coordKey(coord.x, coord.y);
    if (!grid.has(k)) {
      stepToCoord.delete(step);
    }
  }

  // Reajustar outgoing, conectores e isIntersection para celdas supervivientes
  for (const cell of grid.values()) {
    if (cell.isEnd) {
      cell.outgoing = [];
      cell.numConnectors = cell.incoming ? 1 : 0;
      cell.isIntersection = false;
      continue;
    }
    cell.outgoing = cell.outgoing.filter((od) => {
      let dx = DIR_DELTA[od].dx;
      const dy = DIR_DELTA[od].dy;
      if (cell.isStart && od === 'east') dx = 2;
      return grid.has(coordKey(cell.x + dx, cell.y + dy));
    });
    cell.numConnectors = (cell.incoming ? 1 : 0) + cell.outgoing.length;
    cell.isIntersection = cell.outgoing.length >= 2;
  }

  const branchesCount = Array.from(grid.values()).filter((c) => c.isIntersection).length + 1;

  return {
    grid,
    width: gridWidth,
    height: gridHeight,
    startCoord: { x: startX, y: startY },
    endCoords: finalEnds,
    branches: branchesCount,
    maxStep: nextStep - 1,
    stepToCoord,
    coordToStep,
    branchColorOffsets,
  };
}
