import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const Ctx = createContext(null)

// Lo que comparte toda la app: la fuente de datos, el usuario, los catálogos y los
// selectores globales (gestión, moneda y criterio de presupuesto).
export function Sesion({ datos, perfil, onSalir, children }) {
  const [catalogos, setCatalogos] = useState(null)
  const [errorCatalogos, setErrorCatalogos] = useState(null)
  const [version, setVersion] = useState(0)
  const [gestion, setGestion] = useState(null)
  const [moneda, setMoneda] = useState('BS')
  const [criterio, setCriterio] = useState('real')
  const [avisos, setAvisos] = useState([])

  const refrescar = useCallback(() => setVersion((v) => v + 1), [])
  const avisar = useCallback((texto, tono = 'bien') => {
    const id = Math.random().toString(36).slice(2)
    setAvisos((a) => [...a, { id, texto, tono }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4500)
  }, [])

  useEffect(() => {
    let vivo = true
    datos.rpc('catalogos').then((c) => {
      if (!vivo) return
      setCatalogos(c)
      setErrorCatalogos(null)
      setGestion((g) => (g && c.gestiones.some((x) => x.anio === g) ? g : c.gestiones[0]?.anio ?? null))
    }).catch((e) => vivo && setErrorCatalogos(e.message))
    return () => { vivo = false }
  }, [datos, version])

  useEffect(() => datos.suscribir(refrescar), [datos, refrescar])

  const valor = useMemo(() => {
    const rol = perfil?.rol
    return {
      datos, perfil, catalogos, errorCatalogos, version, refrescar, avisar, avisos, onSalir,
      gestion, setGestion, moneda, setMoneda, criterio, setCriterio,
      puede: { importar: rol === 'admin' || rol === 'tecnico', modificar: rol === 'admin' || rol === 'tecnico', administrar: rol === 'admin' },
      gestionCerrada: catalogos?.gestiones.find((g) => g.anio === gestion)?.estado === 'cerrada',
    }
  }, [datos, perfil, catalogos, errorCatalogos, version, refrescar, avisar, avisos, onSalir, gestion, moneda, criterio])

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export const useSesion = () => useContext(Ctx)
