/**
 * Validación de tablero generado.
 *
 * Reglas obligatorias:
 * - Debe tener Inicio y al menos un Final.
 * - Debe existir camino válido (BFS) desde Inicio a algún Final.
 * - Sin piezas superpuestas.
 * - Sin conexiones abiertas inválidas (salida apuntando a vacío).
 * - No exceder inventario.
 * - Respetar patrón cromático rojo→rosado→amarillo→azul.
 * - Sin dos piezas idénticas consecutivas.
 * - Cada desvío debe tener continuidad en TODAS sus salidas.
 */
import { DIR_DELTA, OPPOSITE_DIR, COLOR_CYCLE, PORTAL_FAMILY_BY_KEY } from '../data/tiles';
import type { PlacedTile, SpringSubtype, PortalFamily } from '../data/tiles';
import { TILE_INVENTORY, type TileCategory, inventoryCountFor } from '../data/tileInventory';

const SPRING_VALIDATION: Record<SpringSubtype, {
  pairDistance: number;
  allowedColors: ('rojo' | 'rosado' | 'amarillo' | 'azul')[];
}> = {
  derecha2:   { pairDistance: 2, allowedColors: ['rojo', 'rosado'] },
  derecha4:   { pairDistance: 4, allowedColors: ['amarillo', 'azul'] },
  izquierda2: { pairDistance: 2, allowedColors: ['rojo', 'rosado'] },
  izquierda4: { pairDistance: 4, allowedColors: ['amarillo', 'azul'] },
};
import type { PathResult } from './generatePath';
import type { ColorAssignment } from './assignColors';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    pathLength: number;
    bifurcations: number;
    routesToEnd: number;
  };
}

function coord(x: number, y: number): string {
  return `${x},${y}`;
}

export function validateBoard(
  tiles: Map<string, PlacedTile>,
  _pathResult: PathResult,
  _colorAssignments: Map<string, ColorAssignment>,
  usage: Record<TileCategory, number>,
  opts: {
    relaxedFinalLength?: boolean;
    desiredFinals?: number;
    minFinalLength?: number;
    minCajaMagica?: number;
    maxCajaMagica?: number;
    maxTragaMonedas?: number;
  } = {}
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const {
    desiredFinals = 1,
    minFinalLength = 25,
    minCajaMagica,
    maxCajaMagica,
    maxTragaMonedas,
  } = opts;

  const startTiles = Array.from(tiles.values()).filter((t) => t.category === 'inicio');
  const endTiles = Array.from(tiles.values()).filter((t) => t.category === 'final');

  if (startTiles.length !== 1) {
    errors.push(`Debe haber exactamente 1 Inicio, hay ${startTiles.length}`);
  }
  const minFinals = Math.max(1, (opts.desiredFinals != null ? opts.desiredFinals : 1) - 0);
  const maxFinals = Math.min(4, desiredFinals + 1);
  // Permitir rango [desiredFinals-1 .. desiredFinals+1] para estabilidad
  const flexMinFinals = Math.max(1, minFinals - 1);
  if (endTiles.length < flexMinFinals) {
    errors.push(
      `Faltan Finales: hay ${endTiles.length}, debe haber mínimo ${flexMinFinals} y máximo ${maxFinals} (objetivo ${desiredFinals}).`
    );
  }
  if (endTiles.length > maxFinals) {
    errors.push(
      `Demasiados Finales: hay ${endTiles.length}, debe haber mínimo ${flexMinFinals} y máximo ${maxFinals} (objetivo ${desiredFinals}).`
    );
  }
  if (endTiles.length > 4) {
    errors.push(`Máximo 4 Finales, hay ${endTiles.length}`);
  }

  // --- [REGLA DURA ESPECIALES: Caja Mágica y Tragamonedas por dificultad] ---
  const cajaMagicaTiles = Array.from(tiles.values()).filter((t) => t.category === 'cajaMagica');
  const tragaMonedasTiles = Array.from(tiles.values()).filter((t) => t.category === 'tragaMonedas');
  if (typeof minCajaMagica === 'number') {
    if (cajaMagicaTiles.length < minCajaMagica) {
      errors.push(
        `Mínimo de Cajas Mágicas: ${minCajaMagica}, hay ${cajaMagicaTiles.length}. Deben aparecer siempre de 1 a 3.`
      );
    }
  }
  if (typeof maxCajaMagica === 'number') {
    if (cajaMagicaTiles.length > maxCajaMagica) {
      errors.push(
        `Máximo de Cajas Mágicas: ${maxCajaMagica}, hay ${cajaMagicaTiles.length}.`
      );
    }
  }
  if (typeof maxTragaMonedas === 'number') {
    if (tragaMonedasTiles.length > maxTragaMonedas) {
      errors.push(
        `Máximo de Tragamonedas: ${maxTragaMonedas}, hay ${tragaMonedasTiles.length}. En Tranquila son opcionales (de vez en cuando), nunca más de 1.`
      );
    }
  }
  // Comprobación cromática: Cajas/Tragamonedas (excepto categoría que sea neutral) deben respetar
  // color === COLOR_CYCLE[pathStep % 4], igual que las reglas normales (patrón de colores).
  for (const t of [...cajaMagicaTiles, ...tragaMonedasTiles]) {
    if (t.color === 'neutral') continue;
    const expectedIdx = Math.max(0, Math.floor(t.pathStep ?? 0)) % 4;
    const expectedColor = COLOR_CYCLE[expectedIdx];
    if (t.color !== expectedColor) {
      errors.push(
        `${t.category === 'cajaMagica' ? 'Caja Mágica' : 'Tragamonedas'} en (${t.x},${t.y}) step=${t.pathStep} viola patrón cromático: ${t.color} esperado ${expectedColor}.`
      );
    }
  }

  // --- [REGLA DURA 1 NUEVA MODERADA: TODOS los caminos terminan en Final] ---
  // Cualquier loseta con 1 solo conector (hoja del grafo) que NO sea el Inicio, DEBE ser un Final.
  // No se aceptan ramas cortadas / caminos muertos colgados sin Final (foto 1 usuario).
  const hojasMuertas: PlacedTile[] = [];
  for (const t of tiles.values()) {
    if (t.connectors.length !== 1) continue;
    if (t.category === 'inicio') continue;
    if (t.category === 'final') continue;
    hojasMuertas.push(t);
  }
  if (hojasMuertas.length > 0) {
    const detalle = hojasMuertas
      .map(t => `(${t.x},${t.y})[${t.category}-${t.color} shape=${t.shape}]`)
      .join(', ');
    errors.push(
      `Ramas muertas SIN FINAL (${hojasMuertas.length}): ${detalle}. TODOS los caminos deben terminar en una casilla de Final, no pueden quedar colgados.`
    );
  }

  // --- [REGLA DURA 2 NUEVA MODERADA: Grafo COMPLETAMENTE conexo desde Inicio] ---
  if (startTiles.length === 1) {
    const startK = coord(startTiles[0].x, startTiles[0].y);
    const reach = new Set<string>([startK]);
    const cola: string[] = [startK];
    while (cola.length > 0) {
      const k = cola.shift()!;
      const t = tiles.get(k);
      if (!t) continue;
      for (const conn of t.connectors) {
        let { dx, dy } = DIR_DELTA[conn];
        if (t.shape === 'start' && conn === 'east') dx = 2;
        const nx = t.x + dx;
        const ny = t.y + dy;
        const nk = coord(nx, ny);
        let vecino = tiles.get(nk);
        if (!vecino && conn === 'west' && t.shape !== 'start' && tiles.has(coord(nx - 1, ny))) {
          const maybeStart = tiles.get(coord(nx - 1, ny));
          if (maybeStart && maybeStart.shape === 'start' && maybeStart.connectors.includes('east')) {
            vecino = maybeStart;
          }
        }
        if (!vecino) continue;
        const expectedBack = OPPOSITE_DIR[conn];
        const reciproco =
          (vecino.shape === 'start' && expectedBack === 'east') ||
          vecino.connectors.includes(expectedBack);
        if (!reciproco) continue;
        const vk = coord(vecino.x, vecino.y);
        if (!reach.has(vk)) {
          reach.add(vk);
          cola.push(vk);
        }
      }
    }
    const desconectadas: string[] = [];
    for (const [k, t] of tiles.entries()) {
      if (!reach.has(k)) desconectadas.push(`(${t.x},${t.y})[${t.category}-${t.color}]`);
    }
    if (desconectadas.length > 0) {
      errors.push(
        `Piezas DESCONECTADAS del Inicio (${desconectadas.length}): ${desconectadas.join(', ')}. No puede haber islas / trozos sueltos; todo el tablero debe llevar del Inicio al Final.`
      );
    }
  }

  for (const [_key, tile] of tiles) {
    const count = Array.from(tiles.values()).filter(
      (t) => t.x === tile.x && t.y === tile.y
    ).length;
    if (count > 1) {
      errors.push(`Piezas superpuestas en (${tile.x},${tile.y}) x${count}`);
    }
  }

  for (const [_key, tile] of tiles) {
    for (const conn of tile.connectors) {
      let { dx, dy } = DIR_DELTA[conn];
      if (tile.shape === 'start' && conn === 'east') dx = 2;
      let nx = tile.x + dx;
      let ny = tile.y + dy;
      let neighborKey = coord(nx, ny);
      let neighbor = tiles.get(neighborKey);
      // Caso INVERSO del Start offset: si conn=west, el vecino está vacío pero (nx-1,ny) es un Start
      if (!neighbor && conn === 'west' && tile.shape !== 'start' && tile.shape !== 'end') {
        const maybeStartKey = coord(nx - 1, ny);
        const maybeStart = tiles.get(maybeStartKey);
        if (maybeStart && maybeStart.shape === 'start' && maybeStart.connectors.includes('east')) {
          neighbor = maybeStart;
          neighborKey = maybeStartKey;
        }
      }
      if (!neighbor) {
        if (tile.shape === 'start' || tile.shape === 'end') continue;
        errors.push(
          `Conexión abierta inválida: (${tile.x},${tile.y}) → ${conn} apunta a vacío`
        );
      } else {
        const expectedBack = OPPOSITE_DIR[conn];
        let backDx = -DIR_DELTA[expectedBack].dx;
        let backDy = -DIR_DELTA[expectedBack].dy;
        if (neighbor.shape === 'start' && expectedBack === 'west') backDx = -2;
        const checkX = neighbor.x + backDx;
        const checkY = neighbor.y + backDy;
        if (tile.shape === 'start' && conn === 'east') {
          if (!neighbor.connectors.includes(expectedBack)) {
            if (neighbor.shape !== 'end') {
              errors.push(
                `Conexión no recíproca: Start(${tile.x},${tile.y})→${conn} vs (${nx},${ny}) no tiene ${expectedBack}`
              );
            }
          }
        } else if (neighbor.shape === 'start' && expectedBack === 'west') {
          if (checkX !== tile.x || checkY !== tile.y) {
            errors.push(
              `Conexión no recíproca con Start: (${tile.x},${tile.y}) ← (${neighbor.x},${neighbor.y}) Start expectedBack=${expectedBack}`
            );
          }
        } else {
          if (!neighbor.connectors.includes(expectedBack)) {
            if (neighbor.shape !== 'start' && neighbor.shape !== 'end') {
              errors.push(
                `Conexión no recíproca: (${tile.x},${tile.y})→${conn} vs (${nx},${ny}) no tiene ${expectedBack}`
              );
            }
          }
        }
      }
    }
  }

  for (const cat of Object.keys(TILE_INVENTORY) as TileCategory[]) {
    const max = inventoryCountFor(cat);
    if (usage[cat] > max) {
      errors.push(
        `Inventario excedido: ${cat} = ${usage[cat]} / ${max}`
      );
    }
  }

  // --- [REGLA DURA INTERSECCIONES: solo conectan 3 (I3) o 4 (I4) caminos exactos] ---
  // Si una loseta es intersection3 → 3 bocas exactas; intersection4 → 4 bocas exactas.
  // Start/End siempre 1 boca. Las demás, mínimo 2.
  for (const [_key, tile] of tiles) {
    if (tile.shape === 'start' || tile.shape === 'end') {
      if (tile.connectors.length !== 1) {
        errors.push(
          `${tile.shape} en (${tile.x},${tile.y}): debe tener EXACTAMENTE 1 conector, tiene ${tile.connectors.length}.`
        );
      }
      continue;
    }
    if (tile.shape === 'intersection3') {
      if (tile.connectors.length !== 3) {
        errors.push(
          `Interseccion3 en (${tile.x},${tile.y}): debe conectar EXACTAMENTE 3 caminos, tiene ${tile.connectors.length}.`
        );
      }
      if (tile.category !== 'desvio') {
        errors.push(
          `Interseccion3 en (${tile.x},${tile.y}): categoría debe ser 'desvio', es '${tile.category}'.`
        );
      }
    } else if (tile.shape === 'intersection4') {
      if (tile.connectors.length !== 4) {
        errors.push(
          `Interseccion4 en (${tile.x},${tile.y}): debe conectar EXACTAMENTE 4 caminos, tiene ${tile.connectors.length}.`
        );
      }
      if (tile.category !== 'desvio') {
        errors.push(
          `Interseccion4 en (${tile.x},${tile.y}): categoría debe ser 'desvio', es '${tile.category}'.`
        );
      }
    } else {
      if (tile.connectors.length < 2) {
        errors.push(
          `Loseta sin conexiones completas en (${tile.x},${tile.y}): ${tile.connectors.length} conectores (se requieren 2 mínimos).`
        );
      }
    }
  }

  // --- [REGLA DURA: category='desvio' SOLO cuando shape es intersection3/4] ---
  // (evita que una celda normal/curve se etiquete como 'desvio' sin 3/4 bocas reales).
  for (const [_key, tile] of tiles) {
    if (tile.category === 'desvio' && tile.shape !== 'intersection3' && tile.shape !== 'intersection4') {
      errors.push(
        `Loseta desvío en (${tile.x},${tile.y}): shape debe ser intersection3/4, es '${tile.shape}'.`
      );
    }
  }

  // --- [VALIDACIÓN REGLAS DE RESORTES (SPRINGS)] ---
  // 1. Agrupar springs por subtype y color
  const springsBySubtype: Record<SpringSubtype, { step: number; x: number; y: number; color: string }[]> = {
    derecha2: [], derecha4: [], izquierda2: [], izquierda4: [],
  };
  for (const t of tiles.values()) {
    if (!t.springSubtype) continue;
    springsBySubtype[t.springSubtype].push({
      step: t.pathStep, x: t.x, y: t.y, color: t.color,
    });
  }
  // 2. Chequear color válido por subtype y distancia de pareja
  const subtypeKeys = Object.keys(springsBySubtype) as SpringSubtype[];
  for (const s of subtypeKeys) {
    const info = SPRING_VALIDATION[s];
    const arr = springsBySubtype[s];
    for (const sp of arr) {
      if (sp.color !== 'neutral' && !info.allowedColors.includes(sp.color as any)) {
        errors.push(
          `Resorte ${s} en (${sp.x},${sp.y}) tiene color inválido ${sp.color}. Colores permitidos: ${info.allowedColors.join(',')}`
        );
      }
    }
    if (arr.length === 2) {
      arr.sort((a, b) => a.step - b.step);
      const [first, second] = arr;
      const dist = second.step - first.step;
      if (dist !== info.pairDistance) {
        warnings.push(
          `Resorte ${s}: las 2 piezas están a ${dist} espacios (ideal ${info.pairDistance}) — pasos ${first.step} y ${second.step}.`
        );
      }
    } else if (arr.length > 2) {
      errors.push(
        `Resorte ${s}: inventario excedido. Máximo 2, hay ${arr.length}.`
      );
    } else if (arr.length === 1) {
      warnings.push(
        `Resorte ${s}: pareja incompleta (solo 1 pieza en el paso ${arr[0].step}).`
      );
    }
  }

  // --- [VALIDACIÓN CAMBIO DE DIRECCIÓN: straight 2conn debe ser opuestos / curve no-opuestos] ---
  for (const t of tiles.values()) {
    if (t.shape === 'start' || t.shape === 'end') continue;
    if (t.connectors.length === 2 && t.shape === 'straight') {
      const [a, b] = t.connectors;
      if (OPPOSITE_DIR[a] !== b) {
        errors.push(
          `Cambio de dirección sin curva en (${t.x},${t.y}): loseta shape=straight con conectores ${a}+${b} (no opuestos). Debería ser curva.`
        );
      }
    }
    if (t.connectors.length === 2 && t.shape === 'curve') {
      const [a, b] = t.connectors;
      if (OPPOSITE_DIR[a] === b) {
        errors.push(
          `Curva sin giro en (${t.x},${t.y}): loseta shape=curve con conectores ${a}+${b} (opuestos). Debería ser straight.`
        );
      }
    }
  }

  // --- [VALIDACIÓN ESTRICTA INTERSECCIONES: I3 y I4 deben coincidir con la geometría visual] ---
  const DIRS_ALL: ('north'|'east'|'south'|'west')[] = ['north','east','south','west'];
  for (const t of tiles.values()) {
    if (t.shape !== 'intersection3' && t.shape !== 'intersection4') continue;
    const connSet = new Set(t.connectors);
    if (t.shape === 'intersection4') {
      if (connSet.size !== 4) {
        errors.push(
          `Interseccion4 en (${t.x},${t.y}): debe tener 4 conectores, tiene ${connSet.size} (${t.connectors.join(',')}).`
        );
      }
      if (!connSet.has('north') || !connSet.has('east') || !connSet.has('south') || !connSet.has('west')) {
        errors.push(
          `Interseccion4 en (${t.x},${t.y}): deben estar las 4 direcciones. Conectores actuales: ${t.connectors.join(',')}.`
        );
      }
    }
    if (t.shape === 'intersection3') {
      if (connSet.size !== 3) {
        errors.push(
          `Interseccion3 en (${t.x},${t.y}): debe tener exactamente 3 conectores, tiene ${connSet.size} (${t.connectors.join(',')}).`
        );
        continue;
      }
      // Determinar lado cerrado = la dirección que NO está en connectors
      let closedDir: 'north'|'east'|'south'|'west' | null = null;
      for (const d of DIRS_ALL) { if (!connSet.has(d)) { closedDir = d; break; } }
      if (!closedDir) continue;
      // Determinar lado cerrado del SVG (base=ESTE, según assets/Tablero/Interseccion3.svg rot=0)
      // geom SVG: x=6..165 morado abierto → x=165..227 (ESTE) = verde cerrado.
      const BASE_CLOSED: 'north'|'east'|'south'|'west' = 'east';
      const rotSteps = Math.floor((((t.rotation ?? 0) % 360) + 360) % 360 / 90);
      const idxBase = DIRS_ALL.indexOf(BASE_CLOSED);
      const svgClosedDir: 'north'|'east'|'south'|'west' = DIRS_ALL[(idxBase + rotSteps) % 4];
      if (svgClosedDir !== closedDir) {
        errors.push(
          `Interseccion3 en (${t.x},${t.y}): lado cerrado incorrecto. Rotación=${t.rotation ?? 0}° → lado SVG cerrado debería ser=${svgClosedDir} (franja verde), pero lado realmente cerrado=${closedDir}. Conectores: ${t.connectors.join(',')}.`
        );
      }
    }
  }

  // --- [VALIDACIÓN 2Estrellas: neutral, shape=straight, sin color] ---
  for (const t of tiles.values()) {
    if (t.assetKey === '2Estrellas') {
      if (t.shape !== 'straight') {
        errors.push(`2Estrellas en (${t.x},${t.y}): shape debe ser straight, es ${t.shape}.`);
      }
      if (!t.isNeutral || t.color !== 'neutral') {
        errors.push(`2Estrellas en (${t.x},${t.y}): debe ser neutral (sin color).`);
      }
    }
    if (t.category === 'curve' && t.color === 'neutral') {
      errors.push(`Curva en (${t.x},${t.y}): color neutral no permitido para curvas (debe ser rojo/rosado/amarillo/azul).`);
    }
  }

  // --- [VALIDACIÓN CICLO DE COLOR: cárcel/caja/traga NO 2 del mismo color en ciclo±1] ---
  const CYCLE_LOCK_VALIDATE: TileCategory[] = ['carcel', 'cajaMagica', 'tragaMonedas'];
  for (const cat of CYCLE_LOCK_VALIDATE) {
    const catTiles = Array.from(tiles.values()).filter(t => t.category === cat);
    for (let i = 0; i < catTiles.length; i++) {
      for (let j = i + 1; j < catTiles.length; j++) {
        const a = catTiles[i];
        const b = catTiles[j];
        if (a.color !== 'neutral' && a.color === b.color) {
          const cycleA = Math.floor(a.pathStep / 4);
          const cycleB = Math.floor(b.pathStep / 4);
          if (Math.abs(cycleA - cycleB) <= 1 || Math.abs(a.pathStep - b.pathStep) < 5) {
            errors.push(
              `${cat} repetido: 2 losetas ${cat}-${a.color} en ciclos adyacentes (steps ${a.pathStep} y ${b.pathStep}). Solo 1 por color por ciclo de 4.`
            );
          }
        }
      }
    }
  }

  // --- [VALIDACIÓN REGLAS DE PORTALES (INODOROS)] ---
  const PORTAL_MIN_FINAL_MANHATTAN = 7;
  const PORTAL_MIN_SEP_STEPS = 6;
  const portalsByFamily: Record<PortalFamily, { step: number; x: number; y: number; assetKey: string }[]> = {
    blanco: [], azul: [],
  };
  for (const t of tiles.values()) {
    if (t.category !== 'portal') continue;
    const fam = PORTAL_FAMILY_BY_KEY[t.assetKey];
    if (!fam) {
      errors.push(`Portal sin familia reconocida en (${t.x},${t.y}): assetKey=${t.assetKey}`);
      continue;
    }
    portalsByFamily[fam].push({ step: t.pathStep, x: t.x, y: t.y, assetKey: t.assetKey });
  }
  const totalPortals = portalsByFamily.blanco.length + portalsByFamily.azul.length;
  if (totalPortals > 0 && totalPortals !== 2 && totalPortals !== 4) {
    errors.push(`Portales: deben ser 0, 2 o 4. Hay ${totalPortals}.`);
  }
  for (const fam of ['blanco', 'azul'] as PortalFamily[]) {
    const arr = portalsByFamily[fam];
    if (arr.length === 1) {
      errors.push(`Portal familia ${fam}: pareja incompleta. Hay 1, deben ser 0 o 2 (${arr[0].assetKey}).`);
    } else if (arr.length > 2) {
      errors.push(`Portal familia ${fam}: inventario excedido. Hay ${arr.length}, máximo 2.`);
    }
    for (const p of arr) {
      for (const ec of endTiles) {
        const manhattan = Math.abs(p.x - ec.x) + Math.abs(p.y - ec.y);
        if (manhattan < PORTAL_MIN_FINAL_MANHATTAN) {
          errors.push(
            `Portal ${p.assetKey} en (${p.x},${p.y}): distancia Manhattan a Final = ${manhattan}, mínimo requerido = ${PORTAL_MIN_FINAL_MANHATTAN}.`
          );
        }
      }
    }
  }
  if (portalsByFamily.blanco.length >= 1 && portalsByFamily.azul.length >= 1) {
    const blancoSteps = portalsByFamily.blanco.map(p => p.step);
    const azulSteps = portalsByFamily.azul.map(p => p.step);
    const minBlanco = Math.min(...blancoSteps);
    const maxBlanco = Math.max(...blancoSteps);
    const minAzul = Math.min(...azulSteps);
    const maxAzul = Math.max(...azulSteps);
    const sep = Math.min(
      Math.abs(minBlanco - maxAzul),
      Math.abs(minAzul - maxBlanco),
      Math.abs(minBlanco - minAzul),
      Math.abs(maxBlanco - maxAzul)
    );
    if (sep < PORTAL_MIN_SEP_STEPS) {
      errors.push(
        `Portales: separación entre grupos Blanco y Azul = ${sep} steps. Mínimo requerido = ${PORTAL_MIN_SEP_STEPS}.`
      );
    }
  }

  if (startTiles.length === 1 && endTiles.length >= 1) {
    const canReachEnd = new Set<string>();
    const revQueue: string[] = endTiles.map((t) => coord(t.x, t.y));
    for (const k of revQueue) canReachEnd.add(k);
    while (revQueue.length > 0) {
      const key = revQueue.shift()!;
      const tile = tiles.get(key);
      if (!tile) continue;
      for (const conn of tile.connectors) {
        if (tile.shape === 'end' && conn !== 'west') continue;
        let { dx, dy } = DIR_DELTA[conn];
        let nx = tile.x + dx;
        let ny = tile.y + dy;
        let nk = coord(nx, ny);
        let neighbor = tiles.get(nk);
        if (!neighbor && conn === 'west' && tiles.has(coord(nx - 1, ny))) {
          const maybeStart = tiles.get(coord(nx - 1, ny));
          if (maybeStart && maybeStart.shape === 'start') {
            neighbor = maybeStart;
            nk = coord(nx - 1, ny);
          }
        }
        if (!neighbor) continue;
        const expectedBack = OPPOSITE_DIR[conn];
        const isStartNeighbor = neighbor.shape === 'start' && expectedBack === 'east';
        const connOk = isStartNeighbor || neighbor.connectors.includes(expectedBack);
        if (!connOk) continue;
        const neighborKey = coord(neighbor.x, neighbor.y);
        if (!canReachEnd.has(neighborKey)) {
          canReachEnd.add(neighborKey);
          revQueue.push(neighborKey);
        }
      }
    }
    for (const key of tiles.keys()) {
      if (!canReachEnd.has(key)) {
        const t = tiles.get(key)!;
        if (t.shape === 'end') continue;
        errors.push(
          `Camino muerto en (${t.x},${t.y}): no existe ruta hasta ningún Final.`
        );
      }
    }
  }

  if (startTiles.length === 1 && endTiles.length >= 1) {
    const start = startTiles[0];
    const endKeys = new Set(endTiles.map((t) => coord(t.x, t.y)));
    const endTileList = endTiles.slice();
    const visited = new Set<string>();
    const queue: { x: number; y: number; len: number }[] = [
      { x: start.x, y: start.y, len: 1 },
    ];
    visited.add(coord(start.x, start.y));
    let maxLen = 1;
    let routesToEnd = 0;
    const endLenMap = new Map<string, number>();

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const key = coord(cur.x, cur.y);
      const tile = tiles.get(key);
      if (!tile) continue;
      if (endKeys.has(key)) {
        if (!endLenMap.has(key)) endLenMap.set(key, cur.len);
        routesToEnd++;
        maxLen = Math.max(maxLen, cur.len);
      }
      for (const conn of tile.connectors) {
        let { dx, dy } = DIR_DELTA[conn];
        if (tile.shape === 'start' && conn === 'east') dx = 2;
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const nk = coord(nx, ny);
        if (!visited.has(nk) && tiles.has(nk)) {
          visited.add(nk);
          queue.push({ x: nx, y: ny, len: cur.len + 1 });
        }
      }
    }

    // --- [REGLA DURA 1 USUARIO: Final NUNCA en el medio del camino] ---
    // Cada Final debe ser un nodo HOJA: EXACTAMENTE 1 vecino le apunta por conectividad real.
    // Si hay 2+ predecesores, está en un cruce / medio del recorrido → invalido.
    // Además DEBE tener category='final', shape='end' y connectors.length===1.
    for (const endT of endTileList) {
      const endK = coord(endT.x, endT.y);
      // CAPA 0: identidad propia
      if (endT.category !== 'final' || endT.shape !== 'end' || endT.connectors.length !== 1) {
        errors.push(
          `Final en (${endT.x},${endT.y}) no es una loseta Final real: category=${endT.category} (debe=final), shape=${endT.shape} (debe=end), connectors=${endT.connectors.length} (debe=1). Está en medio de un camino.`
        );
      }
      let predCount = 0;
      // Iterar todas las tiles y ver quién tiene un conector que apunta HACIA endK (bidireccional).
      for (const src of tiles.values()) {
        for (const conn of src.connectors) {
          let { dx, dy } = DIR_DELTA[conn];
          if (src.shape === 'start' && conn === 'east') dx = 2;
          const tgtK = coord(src.x + dx, src.y + dy);
          if (tgtK !== endK) continue;
          // Comprobar recíproco: endT debe tener OPPOSITE_DIR[conn] en sus connectors.
          const expectedBack = OPPOSITE_DIR[conn];
          const backOk = endT.connectors.includes(expectedBack);
          if (backOk) predCount++;
        }
      }
      if (predCount !== 1) {
        errors.push(
          `Final en (${endT.x},${endT.y}) NO es endgame: tiene ${predCount} rutas entrantes (debe ser exactamente 1). No puede quedar en el medio del camino.`
        );
      }
    }

    // --- [REGLA DURA 2 USUARIO: Intersección no permite llegar a Final antes de 25 espacios] ---
    // Para cada Final, su longitud desde Start (por el camino) debe ser >= 25 (o >=minBranchLength si tranquila=29).
    // Si opts.relaxedFinalLength → relajado a 12 (no se usa salvo debug).
    const MIN_FINAL_LENGTH = opts.relaxedFinalLength ? 12 : minFinalLength;
    for (const et of endTileList) {
      const k = coord(et.x, et.y);
      const len = endLenMap.get(k);
      if (len == null) continue; // lo cogerá antes caminos muertos
      if (len < MIN_FINAL_LENGTH) {
        errors.push(
          `Final en (${et.x},${et.y}) alcanzable en solo ${len} espacios desde Inicio. Mínimo permitido = ${MIN_FINAL_LENGTH} (no debe permitirse llegar al Final antes de ese número de casillas).`
        );
      }
    }

    if (endTileList.length >= 2) {
      const lengthsByEnd: { key: string; len: number; x: number; y: number }[] = [];
      for (const et of endTileList) {
        const k = coord(et.x, et.y);
        const l = endLenMap.get(k);
        if (l != null) lengthsByEnd.push({ key: k, len: l, x: et.x, y: et.y });
      }
      if (lengthsByEnd.length >= 2) {
        lengthsByEnd.sort((a, b) => a.len - b.len);
        const maxLen = lengthsByEnd[lengthsByEnd.length - 1].len;
        const minLen = lengthsByEnd[0].len;
        const diff = maxLen - minLen;
        const allowedDiff = opts.relaxedFinalLength ? 4 : 0;

        if (diff > allowedDiff) {
          // Regla de compensación: rama más CORTA debe contener al menos 1 de: carcel / tragaMonedas / retroceder
          // Estas categorías penalizan / retrasan al jugador, por lo que equilibran una ruta más corta.
          const endTileSet = new Set(endTileList.map((t) => coord(t.x, t.y)));

          // Para cada Final corto: BFS inverso desde él hasta el Start, colectando celdas de su rama.
          // Si alguna celda del camino corto pertenece a categoría compensatoria → permite diff.
          let allShortHaveCompensation = true;
          for (const shortEnd of lengthsByEnd.filter((e) => e.len === minLen)) {
            const visitedReverse = new Set<string>();
            const queueRev: string[] = [shortEnd.key];
            visitedReverse.add(shortEnd.key);
            let foundCompensation = false;
            const startKey = coord(start.x, start.y);

            while (queueRev.length > 0 && !foundCompensation) {
              const curK = queueRev.shift()!;
              const curT = tiles.get(curK);
              if (!curT) continue;
              if (curK !== shortEnd.key && !endTileSet.has(curK)) {
                if (
                  curT.category === 'carcel' ||
                  curT.category === 'tragaMonedas' ||
                  curT.category === 'retroceder'
                ) {
                  foundCompensation = true;
                  break;
                }
              }
              if (curK === startKey) continue;
              for (const conn of curT.connectors) {
                let { dx, dy } = DIR_DELTA[conn];
                if (curT.shape === 'end' && conn !== 'west') continue;
                const nx = curT.x + dx;
                const ny = curT.y + dy;
                let nk = coord(nx, ny);
                let neigh = tiles.get(nk);
                // vecino inverso start dx=2
                if (!neigh && conn === 'west') {
                  const maybeK = coord(nx - 1, ny);
                  const maybe = tiles.get(maybeK);
                  if (maybe && maybe.shape === 'start' && maybe.connectors.includes('east')) {
                    neigh = maybe;
                    nk = maybeK;
                  }
                }
                if (!neigh) continue;
                const expectedBack = OPPOSITE_DIR[conn];
                const connOk =
                  (neigh.shape === 'start' && expectedBack === 'east') ||
                  neigh.connectors.includes(expectedBack);
                if (!connOk) continue;
                if (visitedReverse.has(nk)) continue;
                visitedReverse.add(nk);
                queueRev.push(nk);
              }
            }

            if (!foundCompensation) {
              allShortHaveCompensation = false;
              break;
            }
          }

          if (!allShortHaveCompensation) {
            const detalle = lengthsByEnd
              .map((e) => `Final(${e.x},${e.y})=${e.len}pasos`)
              .join(', ');
            errors.push(
              `Rutas a Finales desbalanceadas: ${detalle}. Diferencia=${diff}pasos > permitido=${allowedDiff}. La(s) ruta(s) más corta(s) deben contener al menos 1 Cárcel, Tragamonedas o Retroceder para compensar.`
            );
          }
        }
      }
    }

    const allReachable = visited.size;
    const totalPlaced = tiles.size;
    if (allReachable < totalPlaced) {
      errors.push(
        `Hay piezas desconectadas: ${allReachable}/${totalPlaced} alcanzables desde Inicio`
      );
    }
    if (routesToEnd < 1) {
      errors.push('No existe camino válido desde Inicio a ningún Final');
    }

    const bifurcations = Array.from(tiles.values()).filter(
      (t) => t.category === 'desvio'
    ).length;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        pathLength: maxLen,
        bifurcations,
        routesToEnd,
      },
    };
  }

  let bifurcations = 0;
  for (const t of tiles.values()) {
    if (t.category === 'desvio') bifurcations++;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      pathLength: tiles.size,
      bifurcations,
      routesToEnd: 0,
    },
  };
}

export function validateColorPattern(
  tiles: Map<string, PlacedTile>,
  pathResult: PathResult,
  colorAssignments: Map<string, ColorAssignment>
): string[] {
  const errors: string[] = [];
  const sortedCells = Array.from(pathResult.grid.values()).sort(
    (a, b) => a.pathStep - b.pathStep
  );

  for (const cell of sortedCells) {
    const key = coord(cell.x, cell.y);
    const tile = tiles.get(key);
    if (!tile) continue;
    if (tile.isNeutral || tile.color === 'neutral') continue;
    const assignment = colorAssignments.get(key);
    if (!assignment) continue;

    const expectedIdx = assignment.effectiveStep % 4;
    const actualColor = tile.color as 'rojo' | 'rosado' | 'amarillo' | 'azul';
    const actualIdx = COLOR_CYCLE.indexOf(actualColor);
    if (actualIdx !== expectedIdx) {
      errors.push(
        `Patrón cromático violado en (${cell.x},${cell.y}): esperado ${COLOR_CYCLE[expectedIdx]} (step mod 4=${expectedIdx}), actual ${actualColor}`
      );
    }
  }

  const sorted = Array.from(tiles.values()).sort((a, b) => a.pathStep - b.pathStep);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (Math.abs(cur.pathStep - prev.pathStep) > 1) continue;
    // NUEVA REGLA (usuario 2026-09-22): la separación de especiales es SÓLO por MISMO TIPO.
    // Tipos DIFERENTES pueden ser consecutivos (puntos + cajaMagica OK).
    // Misma categoría consecutiva:
    if (prev.category === cur.category && prev.category !== 'normal' && prev.category !== 'curve') {
      if (prev.color === cur.color) {
        if (
          prev.movementEffect?.type === cur.movementEffect?.type &&
          prev.movementEffect?.amount === cur.movementEffect?.amount
        ) {
          errors.push(
            `Dos piezas idénticas consecutivas en steps ${prev.pathStep} y ${cur.pathStep}: ${cur.category}-${cur.color}`
          );
        }
        if (!prev.movementEffect && !cur.movementEffect) {
          errors.push(
            `Dos piezas idénticas consecutivas en steps ${prev.pathStep} y ${cur.pathStep}: ${cur.category}-${cur.color}`
          );
        }
      } else {
        // Mismo tipo distinto color: alerta (para springs/categoria misma se tolera si son colores dif pero subtype distinto)
        if (prev.springSubtype && cur.springSubtype && prev.springSubtype === cur.springSubtype) {
          errors.push(
            `Dos piezas del MISMO SUBTIPO spring consecutivas en steps ${prev.pathStep} y ${cur.pathStep}: ${cur.springSubtype} (${prev.color} + ${cur.color})`
          );
        }
      }
    }
  }

  return errors;
}

export function validateIntersectionContinuity(
  tiles: Map<string, PlacedTile>
): string[] {
  const errors: string[] = [];
  for (const tile of tiles.values()) {
    if (tile.category !== 'desvio') continue;
    for (const conn of tile.connectors) {
      const { dx, dy } = DIR_DELTA[conn];
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      const nk = coord(nx, ny);
      const neigh = tiles.get(nk);
      if (!neigh) {
        errors.push(
          `Desvío (${tile.x},${tile.y}) salida ${conn} sin continuidad`
        );
        continue;
      }
      if (!neigh.connectors.includes(OPPOSITE_DIR[conn])) {
        errors.push(
          `Desvío (${tile.x},${tile.y}) salida ${conn} no conecta recíprocamente con (${nx},${ny})`
        );
      }
    }
  }
  return errors;
}
