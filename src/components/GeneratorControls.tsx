import { useState } from 'react';
import { parseSeed, type Seed } from '../generation/seededRandom';
import type { Difficulty } from '../generation/generateBoard';

interface GeneratorControlsProps {
  seed: Seed;
  generating: boolean;
  onGenerateNew: () => void;
  onApplySeed: (s: Seed) => void;
  showDebug: boolean;
  onToggleDebug: (v: boolean) => void;
  difficulty: Difficulty;
  onChangeDifficulty: (d: Difficulty) => void;
}

export function GeneratorControls(props: GeneratorControlsProps) {
  const {
    seed,
    generating,
    onGenerateNew,
    onApplySeed,
    showDebug,
    onToggleDebug,
    difficulty,
    onChangeDifficulty,
  } = props;

  const [prevSeed, setPrevSeed] = useState<Seed>(seed);
  const [seedInput, setSeedInput] = useState<string>(String(seed));

  if (seed !== prevSeed) {
    setPrevSeed(seed);
    setSeedInput(String(seed));
  }

  const difficulties: { value: Difficulty; label: string; hint: string }[] = [
    { value: 'tranquila', label: 'Tranquila', hint: 'Estrellas e izquierda/derecha' },
    { value: 'moderada', label: 'Loca', hint: 'Intersecciones, bifurcaciones, cárceles, inodoros y tragamonedas' },
  ];

  return (
    <div className="generator-controls">
      <div className="controls-row">
        <div className="difficulty-group" role="radiogroup" aria-label="Dificultad">
          {difficulties.map((opt) => (
            <button
              key={opt.value}
              className={`diff-btn ${difficulty === opt.value ? 'active' : ''}`}
              onClick={() => onChangeDifficulty(opt.value)}
              title={opt.hint}
              disabled={generating}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="controls-row">
        <button className="primary" onClick={onGenerateNew} disabled={generating}>
          {generating ? 'Generando…' : '🎲 Generar nuevo mapa'}
        </button>
      </div>

      <div className="controls-row seed-row">
        <label className="seed-label">
          Seed:
          <input
            type="text"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const s = parseSeed(seedInput);
                setSeedInput(String(s));
                onApplySeed(s);
              }
            }}
            className="seed-input"
          />
        </label>
        <button
          className="seed-apply"
          onClick={() => {
            const s = parseSeed(seedInput);
            setSeedInput(String(s));
            onApplySeed(s);
          }}
          disabled={generating}
        >
          Aplicar
        </button>
      </div>

      <div className="controls-row">
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={showDebug}
            onChange={(e) => onToggleDebug(e.target.checked)}
          />
          <span>Mostrar debug</span>
        </label>
      </div>
    </div>
  );
}
