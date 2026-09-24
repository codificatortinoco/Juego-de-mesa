import type { TileCategory } from '../data/tileInventory';
import { inventoryCountFor } from '../data/tileInventory';
import type { ValidationResult } from '../generation/validateBoard';

interface BoardStatsProps {
  usage: Record<TileCategory, number>;
  validation: ValidationResult;
  relaxedSeparation: boolean;
}

const CATEGORY_LABELS: Record<TileCategory, string> = {
  normal: 'Normales',
  curve: 'Curvas',
  carcel: 'Cárceles',
  puntos: 'Puntos',
  desvio: 'Desvíos',
  avanzar: 'Avanzar',
  retroceder: 'Retroceder',
  portal: 'Portales',
  cajaMagica: 'Cajas mágicas',
  tragaMonedas: 'Traga-monedas',
  inicio: 'Inicio',
  final: 'Finales',
};

const CATEGORY_ORDER: TileCategory[] = [
  'normal',
  'curve',
  'carcel',
  'puntos',
  'desvio',
  'avanzar',
  'retroceder',
  'portal',
  'cajaMagica',
  'tragaMonedas',
  'inicio',
  'final',
];

export function BoardStats({
  usage,
  validation,
  relaxedSeparation,
}: BoardStatsProps) {
  const total = Object.values(usage).reduce((a, b) => a + b, 0);

  return (
    <div className="board-stats">
      <h3>Estadísticas</h3>

      <div className="stats-grid">
        <div className="stat total">
          <strong>Losetas utilizadas</strong>
          <span className="value">{total}</span>
        </div>
        <div className="stat">
          <strong>Long. ruta principal</strong>
          <span className="value">{validation.stats.pathLength}</span>
        </div>
        <div className="stat">
          <strong>Bifurcaciones</strong>
          <span className="value">{validation.stats.bifurcations}</span>
        </div>
        <div className="stat">
          <strong>Rutas → Final</strong>
          <span className="value">{validation.stats.routesToEnd}</span>
        </div>
      </div>

      <h4>Inventario</h4>
      <ul className="inventory-list">
        {CATEGORY_ORDER.map((cat) => {
        const used = usage[cat] ?? 0;
        const max = inventoryCountFor(cat);
        const pct = max > 0 ? (used / max) * 100 : 0;
        return (
          <li key={cat} className="inv-item">
            <div className="inv-label">
              <span>{CATEGORY_LABELS[cat]}</span>
              <span className="inv-count">
                {used} / {max}
              </span>
            </div>
            <div className="inv-bar">
              <div
              className="inv-fill"
              style={{
                width: `${pct}%`,
                background: pct > 90 ? '#e06' : pct > 60 ? '#e6a23b' : '#2d8',
              }}
            />
            </div>
          </li>
        );
      })}
      </ul>

      {relaxedSeparation && (
        <div className="relaxed-notice">
        ⚠️ Separación entre especiales relajada para completar el mapa.
        </div>
      )}

      {validation.warnings.length > 0 && (
        <details className="warn-details">
          <summary>Warnings ({validation.warnings.length})</summary>
          <ul>
            {validation.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {validation.warnings.length > 20 && (
              <li>… y {validation.warnings.length - 20} más</li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
