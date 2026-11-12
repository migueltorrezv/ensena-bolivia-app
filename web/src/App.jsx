import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { crearDatos } from './datos/index.js'
import { Layout } from './componentes/Layout.jsx'
import { Sesion, useSesion } from './componentes/Sesion.jsx'
import { Cargando, MensajeError } from './componentes/Ui.jsx'
import { useRuta } from './lib/ruta.js'
import Login from './paginas/Login.jsx'

const Tablero = lazy(() => import('./paginas/Tablero.jsx'))
const Reportes = lazy(() => import('./paginas/Reportes.jsx'))
const Movimientos = lazy(() => import('./paginas/Movimientos.jsx'))
const Importar = lazy(() => import('./paginas/Importar.jsx'))
const Modificaciones = lazy(() => import('./paginas/Modificaciones.jsx'))
const Administracion = lazy(() => import('./paginas/Administracion.jsx'))

const PAGINAS = {
  tablero: { titulo: 'Tablero', componente: Tablero },
  reportes: { titulo: 'Reportes', componente: Reportes },
  movimientos: { titulo: 'Detalle de movimientos', componente: Movimientos },
  importar: { titulo: 'Importar Excel', componente: Importar },
  modificaciones: { titulo: 'Modificaciones presupuestarias', componente: Modificaciones },
  admin: { titulo: 'Administración', componente: Administracion },
}

function Contenido() {
  const ruta = useRuta()
  const { catalogos, errorCatalogos, refrescar, puede } = useSesion()
  let actual = ruta.partes[0] || 'tablero'
  if (!PAGINAS[actual] || (actual === 'admin' && !puede.administrar)) actual = 'tablero'
  const { titulo, componente: Pagina } = PAGINAS[actual]
  return (
    <Layout actual={actual} titulo={titulo}>
      {errorCatalogos ? <MensajeError error={`No se pudo conectar con los datos: ${errorCatalogos}`} reintentar={refrescar} />
        : !catalogos ? <Cargando />
          : (
            <Suspense fallback={<Cargando />}>
              <Pagina ruta={ruta} />
            </Suspense>
          )}
    </Layout>
  )
}

export default function App() {
  const [datos, setDatos] = useState(null)
  const [perfil, setPerfil] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    crearDatos()
      .then(async (d) => {
        setDatos(d)
        try {
          setPerfil(await d.sesion())
        } catch {
          setPerfil(null)
        }
      })
      .catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    const expirada = () => setPerfil(null)
    window.addEventListener('sesion-expirada', expirada)
    return () => window.removeEventListener('sesion-expirada', expirada)
  }, [])
  const salir = useCallback(async () => {
    await datos?.salir()
    setPerfil(null)
  }, [datos])

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="mb-3 text-xl font-semibold">No se pudo iniciar la aplicación</h1>
        <MensajeError error={error} />
        <p className="mt-4 text-sm text-texto-2">Revisa el archivo config.js que está junto a esta página.</p>
      </div>
    )
  }
  if (!datos || perfil === undefined) return <Cargando className="p-8" texto="Abriendo…" />
  if (!perfil) return <Login datos={datos} onEntrar={setPerfil} />
  return (
    <Sesion datos={datos} perfil={perfil} onSalir={salir}>
      <Contenido />
    </Sesion>
  )
}
