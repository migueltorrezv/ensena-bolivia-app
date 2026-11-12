import { useEffect, useRef, useState } from 'react'

// Carga datos y conserva lo anterior mientras recarga (sin parpadeo al filtrar).
export function useConsulta(cargar, deps) {
  const [estado, setEstado] = useState({ datos: null, error: null, cargando: true })
  const turno = useRef(0)
  useEffect(() => {
    const mio = ++turno.current
    setEstado((e) => ({ ...e, cargando: true, error: null }))
    Promise.resolve()
      .then(cargar)
      .then((datos) => mio === turno.current && setEstado({ datos, error: null, cargando: false }))
      .catch((err) => mio === turno.current && setEstado((e) => ({ ...e, error: err?.message || String(err), cargando: false })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return estado
}

export function useDiferido(valor, ms = 350) {
  const [v, setV] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return v
}

export function useFueraDe(ref, alSalir, activo = true) {
  useEffect(() => {
    if (!activo) return undefined
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) alSalir() }
    const tecla = (e) => { if (e.key === 'Escape') alSalir() }
    document.addEventListener('mousedown', f)
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', tecla) }
  }, [ref, alSalir, activo])
}
