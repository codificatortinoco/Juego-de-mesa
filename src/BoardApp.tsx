import { useEffect, useState, useMemo } from 'react';
import { Board } from './components/Board';
import { GeneratorControls } from './components/GeneratorControls';
import {
  generateBoard,
  type BoardResult,
  type Difficulty,
} from './generation/generateBoard';
import { generateRandomSeed, type Seed } from './generation/seededRandom';
import './App.css';

export function BoardApp() {
  const [seed, setSeed] = useState<Seed>(() => generateRandomSeed());
  const [boardResult, setBoardResult] = useState<BoardResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('moderada');

  function runGeneration(s: Seed, diff: Difficulty = difficulty) {
    setGenerating(true);
    setError(null);
    try {
      const start = performance.now();
      const result = generateBoard(s, diff);
      const elapsed = performance.now() - start;
      void elapsed;
      console.info(
        `[App] generateBoard(seed=${s}, diff=${diff}) → ${result.attempts} intentos, tiles=${result.tiles.size}, válido=${result.validation.valid}`
      );
      if (!result.validation.valid) {
        console.warn('[App] Validación no superada (errores):', result.validation.errors);
      }
      setBoardResult(result);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    runGeneration(seed, difficulty);
  }, []);

  const tilesMemo = useMemo(
    () => boardResult?.tiles ?? new Map(),
    [boardResult]
  );

  return (
    <div className="app-root">
      <header className="app-header compact">
        <h1>Carrera a la locura</h1>
      </header>

      <GeneratorControls
        seed={boardResult?.seed ?? seed}
        attempts={boardResult?.attempts ?? 0}
        generating={generating}
        onGenerateNew={() => {
          const s = generateRandomSeed();
          setSeed(s);
          runGeneration(s, difficulty);
        }}
        onRegenerateSame={() => {
          const s = boardResult?.seed ?? seed;
          runGeneration(s, difficulty);
        }}
        onNewSeedAndGenerate={(s) => {
          setSeed(s);
          runGeneration(s, difficulty);
        }}
        showDebug={showDebug}
        onToggleDebug={setShowDebug}
        difficulty={difficulty}
        onChangeDifficulty={(d) => {
          setDifficulty(d);
          const s = boardResult?.seed ?? seed;
          runGeneration(s, d);
        }}
      />

      {error && (
        <div className="app-error">
          ❌ {error}
        </div>
      )}

      {boardResult && (
        <main className="app-main compact">
          <section className="board-section full">
            <Board
              tiles={tilesMemo}
              width={boardResult.width}
              height={boardResult.height}
              showDebug={showDebug}
              cellSize={96}
              fitToUsedArea
            />
          </section>
        </main>
      )}

      <footer className="app-footer compact">
        <div className="seed-box">
          Seed: <code>{String(boardResult?.seed ?? seed)}</code>
        </div>
      </footer>
    </div>
  );
}

export default BoardApp;
