import { useState } from 'react';
import { generateRandomSeed, parseSeed, type Seed } from '../generation/seededRandom';
import type { Difficulty } from '../generation/generateBoard';

interface GeneratorControlsProps {
  seed: Seed;
  attempts: number;
  generating: boolean;
  onGenerateNew: () => void;
  onRegenerateSame: () => void;
  onNewSeedAndGenerate: (s: Seed) => void;
  showDebug: boolean;
  onToggleDebug: (v: boolean) => void;
  difficulty: Difficulty;
  onChangeDifficulty: (d: Difficulty) => void;
}

export function GeneratorControls(props: GeneratorControlsProps) {
  const {
    seed,
    attempts,
    generating,
    onGenerateNew,
    onRegenerateSame,
    onNewSeedAndGenerate,
    showDebug,
    onToggleDebug,
    difficulty,
    onChangeDifficulty,
  } = props;

  const [seedInput, setSeedInput] = useState<string>(String(seed));

  const difficulties: { value: Difficulty; label: string; hint: string }[] = [
    { value: 'tranquila', label: 'Tranquila', hint: 'Estrellas e izquierda/derecha' },
    { value: 'moderada', label: 'Moderada', hint: 'Intersecciones, cárceles y tragamonedas' },
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
          {generating ? 'Generando…' : '🎲 Generar mapa'}
        </button>
        <button onClick={onRegenerateSame} disabled={generating}>
          🔁 Regenerar misma seed
        </button>
        <button
          onClick={() => {
            const s = generateRandomSeed();
            setSeedInput(String(s));
            onNewSeedAndGenerate(s);
          }}
          disabled={generating}
        >
          ✨ Nueva seed
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
                onNewSeedAndGenerate(s);
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
            onNewSeedAndGenerate(s);
          }}
          disabled={generating}
        >
          Aplicar
        </button>
        <span className="attempts">
          Intentos: <strong>{attempts}</strong>
        </span>
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
