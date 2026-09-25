import { useEffect, useState } from 'react';
import { CajaPage } from './pages/CajaPage';
import { TragamonedasPage } from './pages/TragamonedasPage';
import { BoardApp } from './BoardApp';
import './App.css';

type Route = '/' | '/caja' | '/tragamonedas';

function normalizePath(raw: string): string {
  let p = (raw ?? '/').trim();
  if (!p.length) p = '/';
  const qIdx = p.indexOf('?');
  if (qIdx >= 0) p = p.slice(0, qIdx);
  p = p.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

function extractFromHash(hash: string): string {
  let h = hash ?? '';
  if (h.startsWith('#')) h = h.slice(1);
  if (!h) return '';
  return normalizePath(h);
}

function resolveRoute(): Route {
  // 1) Hash-mode primero: URL como /#/caja, /#/tragamonedas
  const fromHash = extractFromHash(window.location.hash);
  if (fromHash === '/caja') return '/caja';
  if (fromHash === '/tragamonedas') return '/tragamonedas';

  // 2) Si pathname no es "/", interpretarlo directamente
  //    (sólo funciona si el hosting tiene rewrites SPA configurados)
  const fromPath = normalizePath(window.location.pathname);
  if (fromPath === '/caja') return '/caja';
  if (fromPath === '/tragamonedas') return '/tragamonedas';

  return '/';
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => resolveRoute());

  useEffect(() => {
    // CASO ESPECIAL: Si el usuario entra "en limpio" (URL vacía, ni hash /caja
    // ni /tragamonedas, ni pathname /caja ni /tragamonedas) — redirigir al
    // generador de mapas por defecto (#/). Específicamente: si hay un hash
    // "raro" tipo /#/, /#, vacío, o sólo el pathname /, forzamos la ruta al
    // tablero para que nunca muestre caja/tragamonedas al entrar a la raíz.
    const enforceDefault = () => {
      const hashRaw = window.location.hash ?? '';
      const pathRaw = window.location.pathname ?? '/';
      const pathNorm = normalizePath(pathRaw);
      const hashNorm = extractFromHash(hashRaw);
      const hashOrPathIsCard =
        pathNorm === '/caja' || pathNorm === '/tragamonedas' ||
        hashNorm === '/caja' || hashNorm === '/tragamonedas';
      // Si NO es una ruta de cartas explícita, forzamos a la ruta del tablero
      // (generador de mapas) limpiando el hash sobrante.
      if (!hashOrPathIsCard) {
        const normalizedHash = ''; // Vacío = tablero.
        const newHref =
          window.location.pathname.replace(/\/[^/]*$/, '/') +
          (window.location.search || '') +
          (normalizedHash ? `#${normalizedHash}` : '');
        const cur = window.location.pathname + (window.location.search || '') + (window.location.hash || '');
        const target = window.location.pathname === '/' && hashNorm === '' ? cur : newHref;
        if (target !== cur) {
          history.replaceState(null, '', window.location.pathname + (window.location.search || ''));
        }
      }
    };
    enforceDefault();

    const onChange = () => {
      enforceDefault();
      setRoute(resolveRoute());
    };
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);

    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function wrappedPush(...args) {
      origPush.apply(this, args);
      queueMicrotask(onChange);
    };
    history.replaceState = function wrappedReplace(...args) {
      origReplace.apply(this, args);
      queueMicrotask(onChange);
    };
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);

  if (route === '/caja') return <CajaPage />;
  if (route === '/tragamonedas') return <TragamonedasPage />;
  return <BoardApp />;
}
