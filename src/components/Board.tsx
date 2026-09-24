import { useMemo, useState, useRef, useEffect } from 'react';
import type { PlacedTile } from '../data/tiles';
import { Tile } from './Tile';

interface BoardProps {
  tiles: Map<string, PlacedTile>;
  width: number;
  height: number;
  showDebug?: boolean;
  cellSize?: number;
  fitToUsedArea?: boolean;
}

export function Board({
  tiles,
  width,
  height,
  showDebug = false,
  cellSize = 96,
  fitToUsedArea = false,
}: BoardProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const tilesArr = useMemo(() => Array.from(tiles.values()), [tiles]);

  // Calcular bounding box de las celdas USADAS (no grid 14x14) y ajustar
  // origen/dimensiones del canvas para que solo ocupe lo necesario.
  const {
    offsetX,
    offsetY,
    effectiveW,
    effectiveH,
  } = useMemo(() => {
    if (!fitToUsedArea || tilesArr.length === 0) {
      return { offsetX: 0, offsetY: 0, effectiveW: width, effectiveH: height };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tilesArr) {
      // Start ocupa 2 columnas (x y x+1), así que incluimos +1.
      const spanCols = t.category === 'inicio' ? 2 : 1;
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.x + spanCols - 1 > maxX) maxX = t.x + spanCols - 1;
      if (t.y > maxY) maxY = t.y;
    }
    const safeMinX = Math.max(0, Math.min(width - 1, minX));
    const safeMinY = Math.max(0, Math.min(height - 1, minY));
    const safeMaxX = Math.max(safeMinX, Math.min(width - 1, maxX));
    const safeMaxY = Math.max(safeMinY, Math.min(height - 1, maxY));
    return {
      offsetX: safeMinX,
      offsetY: safeMinY,
      effectiveW: safeMaxX - safeMinX + 1,
      effectiveH: safeMaxY - safeMinY + 1,
    };
  }, [fitToUsedArea, tilesArr, width, height]);

  const boardPx = effectiveW * cellSize * zoom;
  const boardPy = effectiveH * cellSize * zoom;

  function handleWheel(e: React.WheelEvent) {
    if (!viewportRef.current) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom((z) => Math.max(0.3, Math.min(3, z + delta)));
  }

  function handleMouseDown(e: React.MouseEvent) {
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      px: pan.x,
      py: pan.y,
    };
  }

  useEffect(() => {
    function up() {
      setIsDragging(false);
    }
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    function move(e: MouseEvent) {
      setPan({
        x: dragStart.current.px + (e.clientX - dragStart.current.x),
        y: dragStart.current.py + (e.clientY - dragStart.current.y),
      });
    }
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, [isDragging]);

  function centerBoard() {
    setPan({ x: 0, y: 0 });
    setZoom(1);
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    }
    setTimeout(() => {
      if (scrollRef.current) {
        const el = scrollRef.current;
        el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
        el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
      }
    }, 30);
  }

  return (
    <div className="board-wrapper compact">
      <div className="board-toolbar compact">
        <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} title="Acercar">
          Zoom +
        </button>
        <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))} title="Alejar">
          Zoom −
        </button>
        <button onClick={centerBoard} title="Centrar">
          Centrar
        </button>
        <span className="zoom-label">
          Zoom: {(zoom * 100).toFixed(0)}%
        </span>
      </div>

      <div
        ref={viewportRef}
        className="board-viewport compact"
        onWheel={handleWheel}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
      >
        <div
          ref={scrollRef}
          className="board-scroll compact"
        >
          <div
            className="board-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${effectiveW}, ${cellSize}px)`,
              gridTemplateRows: `repeat(${effectiveH}, ${cellSize}px)`,
              width: effectiveW * cellSize,
              height: effectiveH * cellSize,
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 120ms ease',
              backgroundImage:
                'linear-gradient(45deg, rgba(140,220,255,0.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(140,220,255,0.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(140,220,255,0.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(140,220,255,0.12) 75%)',
              backgroundSize: `${cellSize}px ${cellSize}px`,
              backgroundPosition: `0 0, 0 ${cellSize / 2}px, ${cellSize / 2}px ${-cellSize / 2}px, ${-cellSize / 2}px 0px`,
              backgroundColor: '#eaf4fb',
            }}
          >
            {tilesArr.map((tile) => {
              const isStart = tile.category === 'inicio';
              const spanCols = isStart ? 2 : 1;
              const spanRows = 1;
              // Traducir coordenadas globales (x,y) a locales dentro del bbox usado.
              const localX = tile.x - offsetX;
              const localY = tile.y - offsetY;
              return (
                <div
                  key={tile.id}
                  style={{
                    position: 'relative',
                    gridColumnStart: localX + 1,
                    gridColumnEnd: localX + 1 + spanCols,
                    gridRowStart: localY + 1,
                    gridRowEnd: localY + 1 + spanRows,
                    width: spanCols * cellSize,
                    height: spanRows * cellSize,
                  }}
                >
                  <Tile
                    tile={tile}
                    cellSize={cellSize}
                    showDebug={showDebug}
                    spanCols={spanCols}
                    spanRows={spanRows}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="board-dimensions compact">
        {effectiveW} × {effectiveH} · {tiles.size} losetas · {boardPx.toFixed(0)}×{boardPy.toFixed(0)} px
      </div>
    </div>
  );
}
