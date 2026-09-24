import { getAsset } from '../data/assetMap';

const ITEMS: { label: string; assetKey: string; desc: string }[] = [
  { label: 'Inicio', assetKey: 'Inicio', desc: 'Salida del recorrido' },
  { label: 'Final', assetKey: 'Final', desc: 'Meta del recorrido' },
  { label: 'Normal', assetKey: 'Loseta-rojo', desc: 'Loseta básica' },
  { label: 'Curva', assetKey: 'Esquina-azul', desc: 'Giro 90°' },
  { label: 'Desvío 3', assetKey: 'Interseccion3', desc: 'Bifurcación 3 salidas' },
  { label: 'Desvío 4', assetKey: 'Interseccion4', desc: 'Bifurcación 4 salidas' },
  { label: 'Cárcel', assetKey: 'Carcel-rosado', desc: 'Casilla especial' },
  { label: 'Puntos (★)', assetKey: 'Estrella-amarillo', desc: 'Suma puntos' },
  { label: '2 Estrellas', assetKey: '2Estrellas', desc: 'Doble puntuación' },
  { label: 'Portal', assetKey: 'InodoroBlanco-azul', desc: 'Teletransporte' },
  { label: 'Caja mágica', assetKey: 'Caja-azul', desc: 'Efecto aleatorio' },
  { label: 'Traga-monedas', assetKey: 'Tragamonedas-rosado', desc: 'Efecto aleatorio' },
  { label: 'Avanzar +2', assetKey: 'Derecha2-rojo', desc: 'Avanza 2 pasos' },
  { label: 'Avanzar +4', assetKey: 'Derecha4-amarillo', desc: 'Avanza 4 pasos' },
  { label: 'Retroceder -2', assetKey: 'Izquierda2-rosado', desc: 'Retrocede 2 pasos' },
  { label: 'Retroceder -4', assetKey: 'Izquierda4-azul', desc: 'Retrocede 4 pasos' },
];

export function TileLegend() {
  return (
    <div className="tile-legend">
      <h3>Leyenda de piezas</h3>
      <div className="legend-grid">
        {ITEMS.map((it) => (
          <div key={it.assetKey} className="legend-item" title={it.desc}>
            <img
              src={getAsset(it.assetKey)}
              alt={it.label}
              className="legend-thumb"
            />
            <div className="legend-meta">
              <div className="legend-title">{it.label}</div>
              <div className="legend-desc">{it.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
