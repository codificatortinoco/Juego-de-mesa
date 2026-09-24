import { useEffect, useState } from 'react';
import { CajaPage } from './pages/CajaPage';
import { TragamonedasPage } from './pages/TragamonedasPage';
import { BoardApp } from './BoardApp';
import './App.css';

function normalizePath(raw: string): string {
  let p = raw;
  const hashIdx = p.indexOf('#');
  if (hashIdx >= 0) p = p.slice(0, hashIdx);
  const qIdx = p.indexOf('?');
  if (qIdx >= 0) p = p.slice(0, qIdx);
  p = p.toLowerCase();
  if (p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

type Route = '/' | '/caja' | '/tragamonedas';

function getRoute(): Route {
  const np = normalizePath(window.location.pathname || '/');
  if (np === '/caja') return '/caja';
  if (np === '/tragamonedas') return '/tragamonedas';
  return '/';
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => getRoute());

  useEffect(() => {
    const onChange = () => setRoute(getRoute());
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
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
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);

  if (route === '/caja') return <CajaPage />;
  if (route === '/tragamonedas') return <TragamonedasPage />;
  return <BoardApp />;
}
