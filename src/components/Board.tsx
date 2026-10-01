import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
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
  const touchStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);

  const tilesArr = useMemo(() => Array.from(tiles.values()), [tiles]);

  // Calcular bounding box de las celdas USADAS y ajustar
  // origen/dimensiones para que solo ocupe lo necesario sin márgenes fantasma.
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

  // Calcula el zoom exacto para que todo el tablero quepa centrado dentro del viewport
  const calculateFitZoom = useCallback(() => {
    if (!viewportRef.current || effectiveW === 0 || effectiveH === 0) return 1;
    const vp = viewportRef.current;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    if (vpW <= 0 || vpH <= 0) return 1;

    // Margen limpio y cómodo de ~28px alrededor del tablero
    const padding = 28;
    const boardW = effectiveW * cellSize + 16;
    const boardH = effectiveH * cellSize + 16;

    const scaleX = (vpW - padding) / boardW;
    const scaleY = (vpH - padding) / boardH;
    const fitScale = Math.min(scaleX, scaleY);

    return Math.max(0.2, Math.min(1.15, Number(fitScale.toFixed(3))));
  }, [effectiveW, effectiveH, cellSize]);

  const handleFitAndCenter = useCallback(() => {
    const fit = calculateFitZoom();
    setZoom(fit);
    setPan({ x: 0, y: 0 });
  }, [calculateFitZoom]);

  // Al montar o cuando se genera un nuevo mapa (cambia tiles), auto-centramos y ajustamos zoom
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      handleFitAndCenter();
    });
    return () => cancelAnimationFrame(raf);
  }, [handleFitAndCenter, tiles]);

  // Si se redimensiona la ventana y el tablero sigue centrado, mantenemos el ajuste automático
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setPan((currentPan) => {
        if (currentPan.x === 0 && currentPan.y === 0) {
          const fit = calculateFitZoom();
          setZoom(fit);
        }
        return currentPan;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [calculateFitZoom]);

  function handleWheel(e: React.WheelEvent) {
    if (!viewportRef.current) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom((z) => Math.max(0.2, Math.min(3, Number((z + delta).toFixed(3)))));
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      px: pan.x,
      py: pan.y,
    };
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      setIsDragging(true);
      touchStart.current = {
        x: t.clientX,
        y: t.clientY,
        px: pan.x,
        py: pan.y,
      };
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!isDragging || e.touches.length !== 1) return;
    const t = e.touches[0];
    setPan({
      x: touchStart.current.px + (t.clientX - touchStart.current.x),
      y: touchStart.current.py + (t.clientY - touchStart.current.y),
    });
  }

  function handleTouchEnd() {
    setIsDragging(false);
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

  return (
    <div className="board-wrapper compact">
      <div className="board-toolbar compact">
        <button
          onClick={() => setZoom((z) => Math.min(3, Number((z + 0.15).toFixed(2))))}
          title="Acercar"
          type="button"
        >
          Zoom +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.2, Number((z - 0.15).toFixed(2))))}
          title="Alejar"
          type="button"
        >
          Zoom −
        </button>
        <button
          onClick={handleFitAndCenter}
          title="Ajustar y centrar todo el tablero en pantalla"
          type="button"
        >
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
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleFitAndCenter}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        <div
          className="board-stage"
          style={{
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isDragging ? 'none' : 'transform 120ms ease',
          }}
        >
          <div
            className="board-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${effectiveW}, ${cellSize}px)`,
              gridTemplateRows: `repeat(${effectiveH}, ${cellSize}px)`,
              width: effectiveW * cellSize,
              height: effectiveH * cellSize,
              boxSizing: 'border-box',
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

export default Board;
