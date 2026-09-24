import svg2Estrellas from '../assets/Tablero/2Estrellas.svg';
import svgCajaAmarillo from '../assets/Tablero/Caja-amarillo.svg';
import svgCajaAzul from '../assets/Tablero/Caja-azul.svg';
import svgCajaRojo from '../assets/Tablero/Caja-rojo.svg';
import svgCajaRosado from '../assets/Tablero/Caja-rosado.svg';
import svgCarcelAmarillo from '../assets/Tablero/Carcel-amarillo.svg';
import svgCarcelAzul from '../assets/Tablero/Carcel-azul.svg';
import svgCarcelRojo from '../assets/Tablero/Carcel-rojo.svg';
import svgCarcelRosado from '../assets/Tablero/Carcel-rosado.svg';
import svgDerecha2Rojo from '../assets/Tablero/Derecha2-rojo.svg';
import svgDerecha2Rosado from '../assets/Tablero/Derecha2-rosado.svg';
import svgDerecha4Amarillo from '../assets/Tablero/Derecha4-amarillo.svg';
import svgDerecha4Azul from '../assets/Tablero/Derecha4-azul.svg';
import svgEsquinaAmarillo from '../assets/Tablero/Esquina-amarillo.svg';
import svgEsquinaAzul from '../assets/Tablero/Esquina-azul.svg';
import svgEsquinaRojo from '../assets/Tablero/Esquina-rojo.svg';
import svgEsquinaRosado from '../assets/Tablero/Esquina-rosado.svg';
import svgEstrellaAmarillo from '../assets/Tablero/Estrella-amarillo.svg';
import svgEstrellaAzul from '../assets/Tablero/Estrella-azul.svg';
import svgEstrellaRojo from '../assets/Tablero/Estrella-rojo.svg';
import svgEstrellaRosado from '../assets/Tablero/Estrella-rosado.svg';
import svgFinal from '../assets/Tablero/Final.svg';
import svgInicio from '../assets/Tablero/Inicio.svg';
import svgInodoroAzulAmarillo from '../assets/Tablero/InodoroAzul-amarillo.svg';
import svgInodoroAzulRojo from '../assets/Tablero/InodoroAzul-rojo.svg';
import svgInodoroBlancoAzul from '../assets/Tablero/InodoroBlanco-azul.svg';
import svgInodoroBlancoRosado from '../assets/Tablero/InodoroBlanco-rosado.svg';
import svgInterseccion3 from '../assets/Tablero/Interseccion3.svg';
import svgInterseccion4 from '../assets/Tablero/Interseccion4.svg';
import svgIzquierda2Rojo from '../assets/Tablero/Izquierda2-rojo.svg';
import svgIzquierda2Rosado from '../assets/Tablero/Izquierda2-rosado.svg';
import svgIzquierda4Amarillo from '../assets/Tablero/Izquierda4-amarillo.svg';
import svgIzquierda4Azul from '../assets/Tablero/Izquierda4-azul.svg';
import svgLosetaAmarillo from '../assets/Tablero/Loseta-amarillo.svg';
import svgLosetaAzul from '../assets/Tablero/Loseta-azul.svg';
import svgLosetaRojo from '../assets/Tablero/Loseta-rojo.svg';
import svgLosetaRosado from '../assets/Tablero/Loseta-rosado.svg';
import svgTragamonedasAmarillo from '../assets/Tablero/Tragamonedas-amarillo.svg';
import svgTragamonedasAzul from '../assets/Tablero/Tragamonedas-azul.svg';
import svgTragamonedasRojo from '../assets/Tablero/Tragamonedas-rojo.svg';
import svgTragamonedasRosado from '../assets/Tablero/Tragamonedas-rosado.svg';

export type TileColor = 'rojo' | 'rosado' | 'amarillo' | 'azul' | 'neutral';

export const ASSET_MAP: Record<string, string> = {
  '2Estrellas': svg2Estrellas,
  'Caja-amarillo': svgCajaAmarillo,
  'Caja-azul': svgCajaAzul,
  'Caja-rojo': svgCajaRojo,
  'Caja-rosado': svgCajaRosado,
  'Carcel-amarillo': svgCarcelAmarillo,
  'Carcel-azul': svgCarcelAzul,
  'Carcel-rojo': svgCarcelRojo,
  'Carcel-rosado': svgCarcelRosado,
  'Derecha2-rojo': svgDerecha2Rojo,
  'Derecha2-rosado': svgDerecha2Rosado,
  'Derecha4-amarillo': svgDerecha4Amarillo,
  'Derecha4-azul': svgDerecha4Azul,
  'Esquina-amarillo': svgEsquinaAmarillo,
  'Esquina-azul': svgEsquinaAzul,
  'Esquina-rojo': svgEsquinaRojo,
  'Esquina-rosado': svgEsquinaRosado,
  'Estrella-amarillo': svgEstrellaAmarillo,
  'Estrella-azul': svgEstrellaAzul,
  'Estrella-rojo': svgEstrellaRojo,
  'Estrella-rosado': svgEstrellaRosado,
  'Final': svgFinal,
  'Inicio': svgInicio,
  'InodoroAzul-amarillo': svgInodoroAzulAmarillo,
  'InodoroAzul-rojo': svgInodoroAzulRojo,
  'InodoroBlanco-azul': svgInodoroBlancoAzul,
  'InodoroBlanco-rosado': svgInodoroBlancoRosado,
  'Interseccion3': svgInterseccion3,
  'Interseccion4': svgInterseccion4,
  'Izquierda2-rojo': svgIzquierda2Rojo,
  'Izquierda2-rosado': svgIzquierda2Rosado,
  'Izquierda4-amarillo': svgIzquierda4Amarillo,
  'Izquierda4-azul': svgIzquierda4Azul,
  'Loseta-amarillo': svgLosetaAmarillo,
  'Loseta-azul': svgLosetaAzul,
  'Loseta-rojo': svgLosetaRojo,
  'Loseta-rosado': svgLosetaRosado,
  'Tragamonedas-amarillo': svgTragamonedasAmarillo,
  'Tragamonedas-azul': svgTragamonedasAzul,
  'Tragamonedas-rojo': svgTragamonedasRojo,
  'Tragamonedas-rosado': svgTragamonedasRosado,
};

export function getAsset(key: string): string {
  if (!(key in ASSET_MAP)) {
    console.warn(`Asset not found: ${key}`);
    return svgLosetaRojo;
  }
  return ASSET_MAP[key];
}
