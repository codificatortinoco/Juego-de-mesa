import type { TileCategory } from './tileInventory';
import type { TileColor } from './assetMap';
export type { TileColor };
import { getAsset } from './assetMap';

export type Direction = 'north' | 'east' | 'south' | 'west';

export const DIRECTIONS: Direction[] = ['north', 'east', 'south', 'west'];

export const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

export const OPPOSITE_DIR: Record<Direction, Direction> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
};

export const COLOR_CYCLE: TileColor[] = ['rojo', 'rosado', 'amarillo', 'azul'];

export function getColorForStep(step: number): TileColor {
  return COLOR_CYCLE[step % COLOR_CYCLE.length];
}

export type TileShape =
  | 'straight'
  | 'curve'
  | 'intersection3'
  | 'intersection4'
  | 'start'
  | 'end'
  | 'single';

export type SpringSubtype = 'derecha2' | 'derecha4' | 'izquierda2' | 'izquierda4';

export interface TileMetadata {
  id: string;
  category: TileCategory;
  color: TileColor;
  shape: TileShape;
  connectors: Direction[];
  rotation: number;
  assetKey: string;
  special: boolean;
  isNeutral: boolean;
  movementEffect?: {
    type: 'avanzar' | 'retroceder';
    amount: 2 | 4;
  };
  springSubtype?: SpringSubtype;
  puntosAmount?: number;
  portalPairId?: number;
}

export interface PlacedTile extends TileMetadata {
  x: number;
  y: number;
  pathStep: number;
  branchId: number;
  parentStep: number | null;
}

export const MOVEMENT_ASSET_CONFIG: Record<
  string,
  {
    category: TileCategory;
    color: TileColor;
    movementType: 'avanzar' | 'retroceder';
    amount: 2 | 4;
  }
> = {
  'Derecha2-rojo': {
    category: 'avanzar',
    color: 'rojo',
    movementType: 'avanzar',
    amount: 2,
  },
  'Derecha2-rosado': {
    category: 'avanzar',
    color: 'rosado',
    movementType: 'avanzar',
    amount: 2,
  },
  'Derecha4-amarillo': {
    category: 'avanzar',
    color: 'amarillo',
    movementType: 'avanzar',
    amount: 4,
  },
  'Derecha4-azul': {
    category: 'avanzar',
    color: 'azul',
    movementType: 'avanzar',
    amount: 4,
  },
  'Izquierda2-rojo': {
    category: 'retroceder',
    color: 'rojo',
    movementType: 'retroceder',
    amount: 2,
  },
  'Izquierda2-rosado': {
    category: 'retroceder',
    color: 'rosado',
    movementType: 'retroceder',
    amount: 2,
  },
  'Izquierda4-amarillo': {
    category: 'retroceder',
    color: 'amarillo',
    movementType: 'retroceder',
    amount: 4,
  },
  'Izquierda4-azul': {
    category: 'retroceder',
    color: 'azul',
    movementType: 'retroceder',
    amount: 4,
  },
};

export function rotateConnectors(
  connectors: Direction[],
  rotation: number
): Direction[] {
  const steps = Math.floor(((rotation % 360) + 360) % 360 / 90);
  return connectors.map((c) => {
    const idx = DIRECTIONS.indexOf(c);
    return DIRECTIONS[(idx + steps) % 4];
  });
}

export function findRotationToMatch(
  baseConnectors: Direction[],
  requiredConnectors: Direction[]
): number | null {
  const reqSet = new Set(requiredConnectors);
  const baseCardinality = baseConnectors.length;
  const reqCardinality = reqSet.size;
  const useExactEquality = baseCardinality >= 3 || reqCardinality >= 3;
  for (let rot = 0; rot < 360; rot += 90) {
    const rotated = rotateConnectors(baseConnectors, rot);
    const rotSet = new Set(rotated);
    let matches: boolean;
    if (useExactEquality) {
      if (rotSet.size !== reqSet.size) {
        matches = false;
      } else {
        matches = true;
        for (const rc of reqSet) if (!rotSet.has(rc)) { matches = false; break; }
        if (matches) {
          for (const rb of rotSet) if (!reqSet.has(rb)) { matches = false; break; }
        }
      }
    } else {
      matches = requiredConnectors.every((rc) => rotated.includes(rc));
    }
    if (matches) {
      return rot;
    }
  }
  return null;
}

export const BASE_CONNECTORS: Record<TileShape, Direction[]> = {
  straight: ['north', 'south'],
  curve: ['east', 'south'],
  intersection3: ['west', 'north', 'south'],
  intersection4: ['north', 'east', 'south', 'west'],
  start: ['east'],
  end: ['west'],
  single: ['east'],
};

export function getAssetKeyForCategory(
  category: TileCategory,
  color: TileColor,
  specialIndex: number = 0,
  only1StarPuntos: boolean = false
): string {
  const safeColor: 'rojo' | 'rosado' | 'amarillo' | 'azul' =
    color === 'neutral'
      ? (COLOR_CYCLE[specialIndex % 4] as 'rojo')
      : color;

  switch (category) {
    case 'normal':
      return `Loseta-${safeColor}`;
    case 'curve':
      return `Esquina-${safeColor}`;
    case 'carcel':
      return `Carcel-${safeColor}`;
    case 'puntos':
      if (!only1StarPuntos && specialIndex % 5 === 4) {
        return '2Estrellas';
      }
      return `Estrella-${safeColor}`;
    case 'desvio':
      return specialIndex % 2 === 1 ? 'Interseccion4' : 'Interseccion3';
    case 'avanzar': {
      const suffix = safeColor === 'amarillo' || safeColor === 'azul' ? '4' : '2';
      return `Derecha${suffix}-${safeColor}`;
    }
    case 'retroceder': {
      const suffix = safeColor === 'amarillo' || safeColor === 'azul' ? '4' : '2';
      return `Izquierda${suffix}-${safeColor}`;
    }
    case 'portal':
      return getPortalAssetKey(safeColor, specialIndex);
    case 'cajaMagica':
      return `Caja-${safeColor}`;
    case 'tragaMonedas':
      return `Tragamonedas-${safeColor}`;
    case 'inicio':
      return 'Inicio';
    case 'final':
      return 'Final';
    default:
      return `Loseta-${color}`;
  }
}

export type PortalFamily = 'blanco' | 'azul';

const PORTAL_PATTERNS = [
  ['InodoroBlanco-azul', 'InodoroBlanco-rosado', 'InodoroAzul-amarillo', 'InodoroAzul-rojo'],
];

export const PORTAL_FAMILY_BY_KEY: Record<string, PortalFamily> = {
  'InodoroBlanco-azul': 'blanco',
  'InodoroBlanco-rosado': 'blanco',
  'InodoroAzul-amarillo': 'azul',
  'InodoroAzul-rojo': 'azul',
};

export const PORTAL_PAIR_MEMBER: Record<PortalFamily, [string, string]> = {
  blanco: ['InodoroBlanco-azul', 'InodoroBlanco-rosado'],
  azul: ['InodoroAzul-amarillo', 'InodoroAzul-rojo'],
};

function getPortalAssetKey(color: TileColor, idx: number): string {
  const patternIdx = idx % PORTAL_PATTERNS.length;
  const pattern = PORTAL_PATTERNS[patternIdx];
  const colorIdx = COLOR_CYCLE.indexOf(color as 'rojo');
  return pattern[colorIdx >= 0 ? colorIdx : idx % pattern.length];
}

export function createTileFromCategory(
  category: TileCategory,
  color: TileColor,
  shape: TileShape,
  requiredConnectors: Direction[],
  specialIndex: number = 0,
  only1StarPuntos: boolean = false
): TileMetadata | null {
  // REGLA DURA: las curvas NUNCA son neutrales. Son siempre por color.
  if (category === 'curve' && color === 'neutral') return null;
  let assetKey = getAssetKeyForCategory(category, color, specialIndex, only1StarPuntos);
  // Para intersecciones (desvíos): assetKey depende del SHAPE real de la celda del grid,
  // no de specialIndex%2 (lo anterior fallaba si la celda pide intersection3 y salía Interseccion4).
  if (category === 'desvio') {
    assetKey = shape === 'intersection4' ? 'Interseccion4' : 'Interseccion3';
  }
  const assetUrl = getAsset(assetKey);
  if (!assetUrl) {
    console.warn(`Missing asset for key: ${assetKey}`);
  }

  let baseConnectors: Direction[];
  let rotation: number | null;
  // REGLA DURA ABSOLUTA para Intersection3:
  //   - La loseta REAL (SVG assets/Tablero/Interseccion3.svg) tiene 1 lado CERRADO (verde = pared)
  //     y 3 ABIERTOS (bocas).
  //   - En rotación=0 → lado cerrado = ESTE, bocas = [west, north, south].
  //     (Geom: el morado abarca x=6..165, dejando x=165..227 ESTE=verde).
  //   - Cualquier conjunto de 3 requiredConnectors (sin duplicados, size===3) es VÁLIDO
  //     siempre que NO tenga los 4 lados. La "dirección cerrada" = la que falta en el set.
  //   - Para mantener el "lado cerrado" alineado con la realidad visual, calculamos la
  //     rotación necesaria para que rotateConnectors([W,N,S], rot) === requiredConnectors.
  //   - Equivalentemente: rotate(ESTE, rot) === closedDir (el lado cerrado del grid).
  //   - Si required NO tiene size===3 → no se puede colocar I3 aquí (null).
  if (category === 'desvio' && shape === 'intersection3') {
    const reqSet = new Set(requiredConnectors);
    if (reqSet.size !== 3) {
      return null;
    }
    // Calcular qué dirección FALTA (será el "lado cerrado" que debe coincidir con el
    // ESTE del SVG base en rotación=0).
    let closedDir: Direction | null = null;
    for (const d of DIRECTIONS) {
      if (!reqSet.has(d)) { closedDir = d; break; }
    }
    if (!closedDir) return null;
    const BASE_CLOSED_DIR: Direction = 'east';
    const idxBase = DIRECTIONS.indexOf(BASE_CLOSED_DIR);
    const idxC = DIRECTIONS.indexOf(closedDir);
    const rotSteps = ((idxC - idxBase) + 4) % 4;
    const candidateRot = rotSteps * 90;
    // Validación final: comprobar que los conectores base rotados coinciden EXACTAMENTE
    const rotatedBase = new Set(rotateConnectors(['west', 'north', 'south'], candidateRot));
    for (const rc of requiredConnectors) {
      if (!rotatedBase.has(rc)) return null;
    }
    for (const rb of rotatedBase) {
      if (!reqSet.has(rb)) return null;
    }
    baseConnectors = ['west', 'north', 'south'];
    rotation = candidateRot;
  } else {
    const isMovementTile = category === 'avanzar' || category === 'retroceder';
    baseConnectors = isMovementTile
      ? (shape === 'curve' ? ['east', 'south'] : ['west', 'east'])
      : BASE_CONNECTORS[shape];
    // === REGLA DURA ESPECIAL Start / End ===
    // NUNCA se permite que una loseta de Inicio o Final tenga más de 1 conector.
    // Si el grid pide 2+ conectores (por celda marcada erróneamente como isEnd/isStart pero
    // en medio del camino → celda intermedia), RETORNAR NULL para que se coloque otra categoría.
    if ((shape === 'start' || shape === 'end') && requiredConnectors.length !== 1) {
      return null;
    }
    rotation = findRotationToMatch(baseConnectors, requiredConnectors);
    if (rotation === null && shape !== 'start' && shape !== 'end') {
      return null;
    }
    // SEGUNDA CAPA SEGURIDAD Start/End: aunque rotation sea null, los conectores
    // resultantes SOLO pueden ser 1. Si requiredConnectors tiene != 1, return null.
    if ((shape === 'start' || shape === 'end') && requiredConnectors.length !== 1) {
      return null;
    }
  }
  const isNeutral =
    category === 'inicio' ||
    category === 'final' ||
    category === 'desvio' ||
    assetKey === '2Estrellas';

  const special = [
    'carcel',
    'puntos',
    'desvio',
    'avanzar',
    'retroceder',
    'portal',
    'cajaMagica',
    'tragaMonedas',
  ].includes(category);

  const result: TileMetadata = {
    id: `${category}-${color}-${specialIndex}-${Date.now()}-${Math.random()}`,
    category,
    color: isNeutral ? 'neutral' : color,
    shape,
    connectors:
      rotation !== null
        ? rotateConnectors(baseConnectors, rotation)
        : requiredConnectors,
    rotation: rotation ?? 0,
    assetKey,
    special,
    isNeutral,
  };

  if (category === 'avanzar' || category === 'retroceder') {
    const moveCfg = MOVEMENT_ASSET_CONFIG[assetKey];
    result.movementEffect = {
      type: category,
      amount: moveCfg?.amount ?? 2,
    };
    if (assetKey.startsWith('Derecha2')) result.springSubtype = 'derecha2';
    else if (assetKey.startsWith('Derecha4')) result.springSubtype = 'derecha4';
    else if (assetKey.startsWith('Izquierda2')) result.springSubtype = 'izquierda2';
    else if (assetKey.startsWith('Izquierda4')) result.springSubtype = 'izquierda4';
  }

  if (category === 'puntos' && assetKey === '2Estrellas') {
    result.puntosAmount = 2;
  } else if (category === 'puntos') {
    result.puntosAmount = 1;
  }

  return result;
}

export function createStartTile(direction: Direction): TileMetadata {
  const baseConnectors = BASE_CONNECTORS.start; // ['east'] según el diseño del SVG
  const rotation = findRotationToMatch(baseConnectors, [direction]);
  return {
    id: `start-${direction}`,
    category: 'inicio',
    color: 'neutral',
    shape: 'start',
    connectors: rotation !== null ? rotateConnectors(baseConnectors, rotation) : [direction],
    rotation: rotation ?? (DIRECTIONS.indexOf(direction) * 90) % 360,
    assetKey: 'Inicio',
    special: false,
    isNeutral: true,
  };
}

export function createEndTile(fromDirection: Direction): TileMetadata {
  const baseConnectors = BASE_CONNECTORS.end; // ['west'] según el diseño del SVG
  const rotation = findRotationToMatch(baseConnectors, [fromDirection]);
  return {
    id: `end-${fromDirection}-${Math.random()}`,
    category: 'final',
    color: 'neutral',
    shape: 'end',
    connectors: rotation !== null ? rotateConnectors(baseConnectors, rotation) : [fromDirection],
    rotation: rotation ?? (DIRECTIONS.indexOf(fromDirection) * 90 + 180) % 360,
    assetKey: 'Final',
    special: false,
    isNeutral: true,
  };
}
