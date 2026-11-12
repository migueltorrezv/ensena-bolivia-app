import { useEffect, useState } from 'react'

// Rutas con nombres simples (#tablero, #reportes-region): funcionan en cualquier hosting y
// también dentro de vistas previas que solo aceptan #nombre. Los filtros que viajan entre
// pantallas (p. ej. al tocar una fila) van en memoria, no en la dirección.
let pendiente = null

function leer() {
  const hash = window.location.hash
  const limpio = decodeURIComponent(hash.replace(/^#\/?/, '')).split('?')[0]
  const [pagina, ...resto] = limpio.split(/[-/]/)
  if (pendiente && pendiente.hash !== hash) pendiente = null
  return { partes: [pagina, resto.join('-')].filter(Boolean), params: pendiente ? pendiente.params : new URLSearchParams() }
}

export function useRuta() {
  const [ruta, setRuta] = useState(leer)
  useEffect(() => {
    const cambio = () => setRuta(leer())
    window.addEventListener('hashchange', cambio)
    return () => window.removeEventListener('hashchange', cambio)
  }, [])
  return ruta
}

export function ir(camino, params) {
  const hash = `#${camino.replace(/\//g, '-')}`
  pendiente = { hash, params: new URLSearchParams(params || {}) }
  if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else window.location.hash = hash
}

export const irConFiltros = (camino, filtros) => ir(camino, { f: JSON.stringify(filtros) })

export function filtrosDeRuta(params) {
  try {
    return JSON.parse(params.get('f') || '{}')
  } catch {
    return {}
  }
}
