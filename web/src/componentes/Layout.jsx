import { useState } from 'react'
import { FileUp, KeyRound, LayoutDashboard, ListOrdered, LogOut, Menu, PencilLine, Settings, Table2, X } from 'lucide-react'
import { CONFIG } from '../config.js'
import { ir } from '../lib/ruta.js'
import { useSesion } from './Sesion.jsx'
import { Boton, Campo, claseCampo, cx, Modal, Segmentado } from './Ui.jsx'
import { Chatbot } from './Chatbot.jsx'

const ROLES = { admin: 'Admin', tecnico: 'Técnico', lector: 'Lector' }

function Marca() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#ffffff" fillOpacity="0.1" />
      <rect x="7" y="17" width="4" height="8" rx="1" fill="#26A567" />
      <rect x="14" y="11" width="4" height="14" rx="1" fill="#26A567" />
      <rect x="21" y="7" width="4" height="18" rx="1" fill="#ffffff" />
    </svg>
  )
}

function CambiarClave({ abierto, onCerrar }) {
  const { datos, perfil, avisar } = useSesion()
  const [clave, setClave] = useState('')
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const guardar = async () => {
    setEnviando(true)
    setError(null)
    try {
      await datos.cambiarClave(perfil.user_id, clave)
      avisar('Contraseña cambiada')
      setClave('')
      onCerrar()
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Modal abierto={abierto} titulo="Cambiar mi contraseña" onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" onClick={guardar} cargando={enviando} disabled={clave.length < 8}>Cambiar contraseña</Boton></>}>
      <Campo etiqueta="Nueva contraseña" ayuda="Al menos 8 caracteres.">
        <input type="password" className={claseCampo} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" />
      </Campo>
      {error && <p className="mt-3 text-sm text-critico">{error}</p>}
    </Modal>
  )
}

export function Layout({ actual, titulo, children }) {
  const { datos, perfil, puede, catalogos, gestion, setGestion, moneda, setMoneda, criterio, setCriterio, avisos, onSalir } = useSesion()
  const [menu, setMenu] = useState(false)
  const [clave, setClave] = useState(false)
  const enlaces = [
    { ruta: 'tablero', texto: 'Tablero', icono: LayoutDashboard },
    { ruta: 'reportes', texto: 'Reportes', icono: Table2 },
    { ruta: 'movimientos', texto: 'Movimientos', icono: ListOrdered },
    { ruta: 'importar', texto: 'Importar Excel', icono: FileUp },
    { ruta: 'modificaciones', texto: 'Modificaciones', icono: PencilLine },
    ...(puede.administrar ? [{ ruta: 'admin', texto: 'Administración', icono: Settings }] : []),
  ]

  const lateral = (
    <nav className="flex h-full flex-col bg-tinta text-white" aria-label="Secciones">
      <div className="flex items-center gap-3 px-5 pt-5 pb-6">
        <Marca />
        <div className="min-w-0 leading-tight">
          <p className="text-[15px] font-semibold">Control presupuestario de Enseña por Bolivia</p>
          <p className="truncate text-[12.5px] text-white/60">{CONFIG.ORGANIZACION || 'Ejecución financiera'}</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {enlaces.map(({ ruta, texto, icono: I }) => (
          <li key={ruta}>
            <a href={`#${ruta}`} onClick={(e) => { setMenu(false); if (actual === ruta) { e.preventDefault(); ir(ruta) } }} aria-current={actual === ruta ? 'page' : undefined}
              className={cx('flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors',
                actual === ruta ? 'bg-white/12 font-medium text-white' : 'text-white/72 hover:bg-white/8 hover:text-white')}>
              <I className="size-[18px]" aria-hidden />{texto}
            </a>
          </li>
        ))}
      </ul>
      <div className="m-3 rounded-lg bg-black/15 p-3 text-[13px]">
        <p className="truncate font-medium" title={perfil.email}>{perfil.email}</p>
        <p className="mt-0.5 text-white/60">{ROLES[perfil.rol] || perfil.rol} · {datos.etiqueta}</p>
        <div className="mt-2.5 flex gap-1">
          {datos.modo !== 'demo' && (
            <button type="button" onClick={() => setClave(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-white/75 hover:bg-white/10 hover:text-white">
              <KeyRound className="size-4" aria-hidden />Contraseña
            </button>
          )}
          <button type="button" onClick={onSalir} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-white/75 hover:bg-white/10 hover:text-white">
            <LogOut className="size-4" aria-hidden />Salir
          </button>
        </div>
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 lg:block">{lateral}</aside>
      {menu && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-[#1b2420]/50" onClick={() => setMenu(false)} />
          <aside className="relative h-full w-64">
            {lateral}
            <button type="button" onClick={() => setMenu(false)} className="absolute top-4 right-3 rounded-md p-1.5 text-white/70 hover:bg-white/10" aria-label="Cerrar menú">
              <X className="size-5" />
            </button>
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-borde bg-fondo/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-8">
          <button type="button" className="rounded-md p-1.5 text-texto-2 hover:bg-superficie lg:hidden" onClick={() => setMenu(true)} aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>
          <h1 className="mr-auto text-lg font-semibold tracking-tight">{titulo}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-borde-fuerte bg-superficie pl-3 text-sm">
              <span className="text-texto-2">Gestión</span>
              <select value={gestion ?? ''} onChange={(e) => setGestion(Number(e.target.value))} className="h-8 rounded-md bg-transparent pr-2 font-semibold focus:outline-none">
                {(catalogos?.gestiones || []).map((g) => <option key={g.anio} value={g.anio}>{g.anio}{g.estado === 'cerrada' ? ' (cerrada)' : ''}</option>)}
              </select>
            </label>
            <Segmentado etiqueta="Moneda" valor={moneda} onCambiar={setMoneda} opciones={[{ valor: 'BS', etiqueta: 'Bs' }, { valor: 'USD', etiqueta: 'USD' }]}
              titulo="Bolivianos o dólares. En dólares, el gasto usa la tasa de cada movimiento y el presupuesto la tasa de la gestión." />
            <Segmentado etiqueta="Criterio de presupuesto" valor={criterio} onCambiar={setCriterio}
              opciones={[{ valor: 'real', etiqueta: 'Presupuesto real' }, { valor: 'excel', etiqueta: 'Como el Excel' }]}
              titulo="Real: solo las filas de presupuesto. Como el Excel: suma también el gasto, igual que las tablas dinámicas del archivo." />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">{children}</main>

      <div className="pointer-events-none fixed right-4 bottom-20 z-50 flex flex-col gap-2" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={cx('pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-sm shadow-lg',
            a.tono === 'error' ? 'border-[#f2c5c5] bg-[#fbeaea] text-[#7d1a1a]' : 'border-borde bg-superficie text-texto')}>
            {a.texto}
          </div>
        ))}
      </div>
      <CambiarClave abierto={clave} onCerrar={() => setClave(false)} />
      <Chatbot />
    </div>
  )
}
