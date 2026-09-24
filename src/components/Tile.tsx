import type { PlacedTile } from '../data/tiles';
import { getAsset } from '../data/assetMap';

interface TileProps {
  tile: PlacedTile;
  cellSize: number;
  showDebug?: boolean;
  spanCols?: number;
  spanRows?: number;
}

export function Tile({
  tile,
  cellSize,
  showDebug = false,
  spanCols = 1,
  spanRows = 1,
}: TileProps) {
  const assetUrl = getAsset(tile.assetKey);
  const isStartEnd = tile.category === 'inicio' || tile.category === 'final';
  const rotation = isStartEnd ? 0 : tile.rotation ?? 0;
  void cellSize; void spanCols; void spanRows;

  const effectText = tile.movementEffect
    ? `${tile.movementEffect.type === 'avanzar' ? '+' : '-'}${tile.movementEffect.amount}`
    : tile.puntosAmount
    ? `★${tile.puntosAmount}`
    : '';

  const shouldClip = isStartEnd;

  return (
    <div
      className="board-tile"
      data-x={tile.x}
      data-y={tile.y}
      data-shape={tile.shape}
      data-cat={tile.category}
      data-color={tile.color}
      data-rotation={rotation}
      data-connectors={(tile.connectors || []).join(',')}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: shouldClip ? 'hidden' : 'visible',
        zIndex: isStartEnd ? 2 : 1,
      }}
    >
      <img
        src={assetUrl}
        alt={`${tile.category}-${tile.color}`}
        draggable={false}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: isStartEnd ? 'contain' : 'cover',
          transform: `rotate(${rotation}deg)`,
          transformOrigin: 'center center',
          display: 'block',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
      {showDebug && (
        <div
          className="tile-debug"
          style={{
            position: 'absolute',
            inset: 0,
            padding: 2,
            fontSize: 8,
            lineHeight: 1.1,
            color: '#111',
            background: 'rgba(255,255,200,0.72)',
            pointerEvents: 'none',
            overflow: 'hidden',
            fontFamily: 'monospace',
            zIndex: 5,
          }}
        >
          <div>#{tile.pathStep}</div>
          <div>
            ({tile.x},{tile.y})
          </div>
          <div style={{ opacity: 0.85 }}>{tile.category}</div>
          <div style={{ opacity: 0.75 }}>{tile.color}</div>
          <div style={{ opacity: 0.65 }}>rot:{rotation}°</div>
          <div style={{ opacity: 0.6 }}>
            {tile.connectors.slice(0, 2).map((c) => c[0]).join('')}
            {tile.connectors.length > 2 ? `+${tile.connectors.length - 2}` : ''}
          </div>
          {effectText && <div style={{ fontWeight: 700, color: '#800' }}>{effectText}</div>}
        </div>
      )}
    </div>
  );
}
