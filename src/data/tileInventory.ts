export type ColorName = 'rojo' | 'rosado' | 'amarillo' | 'azul';
export const COLOR_ORDER: ColorName[] = ['rojo', 'rosado', 'amarillo', 'azul'];

export type SubCategory =
  | '1estrella'
  | '2estrellas'
  | 'desv3'
  | 'desv4'
  | 'derecha2'
  | 'derecha4'
  | 'izquierda2'
  | 'izquierda4'
  | 'retroceder2'
  | 'retroceder4'
  | 'portalBlanco'
  | 'portalAzul';

export type InventoryByColor = Record<
  ColorName,
  number
>;

export interface CategoryInventory {
  perColor: InventoryByColor;
  /** sub counts (sólo algunas categorías), colorKeyed si aplica */
  sub?: Partial<Record<SubCategory, number>>;
}

export const TILE_INVENTORY = {
  normal: { perColor: { rojo: 7, rosado: 7, amarillo: 7, azul: 7 } } as CategoryInventory,
  curve:  { perColor: { rojo: 3, rosado: 3, amarillo: 3, azul: 3 } } as CategoryInventory,
  carcel: { perColor: { rojo: 2, rosado: 2, amarillo: 2, azul: 2 } } as CategoryInventory,
  puntos: { perColor: { rojo: 1, rosado: 1, amarillo: 1, azul: 1 },
            sub: { '1estrella': 4, '2estrellas': 2 } } as CategoryInventory,
  desvio: { perColor: { rojo: 0, rosado: 0, amarillo: 0, azul: 0 },
            sub: { 'desv3': 4, 'desv4': 3 } } as CategoryInventory,
  avanzar:{ perColor: { rojo: 2, rosado: 2, amarillo: 2, azul: 2 },
            sub: { 'derecha2': 2, 'derecha4': 2, 'izquierda2': 2, 'izquierda4': 2 } } as CategoryInventory,
  retroceder: { perColor: { rojo: 1, rosado: 1, amarillo: 1, azul: 1 },
                sub: { 'retroceder2': 2, 'retroceder4': 2 } } as CategoryInventory,
  portal: { perColor: { rojo: 0, rosado: 0, amarillo: 0, azul: 0 },
            sub: { 'portalBlanco': 2, 'portalAzul': 2 } } as CategoryInventory,
  cajaMagica: { perColor: { rojo: 1, rosado: 1, amarillo: 1, azul: 1 } } as CategoryInventory,
  tragaMonedas: { perColor: { rojo: 1, rosado: 1, amarillo: 1, azul: 1 } } as CategoryInventory,
  inicio: { perColor: { rojo: 0, rosado: 0, amarillo: 0, azul: 0 }, total: 2 } as CategoryInventory & { total: number },
  final:  { perColor: { rojo: 0, rosado: 0, amarillo: 0, azul: 0 }, total: 2 } as CategoryInventory & { total: number },
};

export type TileCategory = keyof typeof TILE_INVENTORY;

export function inventoryCountFor(cat: TileCategory, color?: ColorName): number {
  const inv = TILE_INVENTORY[cat] as any;
  if (color) return inv.perColor[color] ?? 0;
  if (inv.total !== undefined) return inv.total as number;

  // Conteos según inventario físico verificado (total 92 piezas).
  // Ciertas categorías usan `sub` como fuente canónica (desvíos, portales, springs,
  // puntos 2★) para evitar duplicar lo que ya está representado en perColor.
  switch (cat) {
    case 'desvio':
      return (inv.sub?.desv3 ?? 0) + (inv.sub?.desv4 ?? 0);
    case 'portal':
      return (inv.sub?.portalBlanco ?? 0) + (inv.sub?.portalAzul ?? 0);
    case 'puntos':
      return (inv.sub?.['1estrella'] ?? 0) + (inv.sub?.['2estrellas'] ?? 0);
    case 'avanzar':
      return (
        (inv.sub?.derecha2 ?? 0) +
        (inv.sub?.derecha4 ?? 0) +
        (inv.sub?.izquierda2 ?? 0) +
        (inv.sub?.izquierda4 ?? 0)
      );
    case 'retroceder':
      return (inv.sub?.retroceder2 ?? 0) + (inv.sub?.retroceder4 ?? 0);
    default:
      return Object.values(inv.perColor as InventoryByColor).reduce(
        (a, b) => a + b,
        0
      );
  }
}

export const INVENTORY_TOTAL = (
  inventoryCountFor('normal') +
  inventoryCountFor('curve') +
  inventoryCountFor('carcel') +
  inventoryCountFor('puntos') +
  inventoryCountFor('desvio') +
  inventoryCountFor('avanzar') +
  inventoryCountFor('retroceder') +
  inventoryCountFor('portal') +
  inventoryCountFor('cajaMagica') +
  inventoryCountFor('tragaMonedas') +
  inventoryCountFor('inicio') +
  inventoryCountFor('final')
);

export const SPECIAL_CATEGORIES: TileCategory[] = [
  'carcel',
  'puntos',
  'desvio',
  'avanzar',
  'retroceder',
  'portal',
  'cajaMagica',
  'tragaMonedas',
];

export const MOVEMENT_CATEGORIES: TileCategory[] = ['avanzar', 'retroceder'];
