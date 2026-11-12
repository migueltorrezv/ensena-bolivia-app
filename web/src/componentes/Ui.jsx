import { useEffect, useRef } from 'react'
import { CircleAlert, CircleCheck, Info, LoaderCircle, OctagonAlert, TriangleAlert, X } from 'lucide-react'

export const cx = (...c) => c.filter(Boolean).join(' ')

const VARIANTES = {
  primario: 'bg-tinta text-white hover:bg-tinta-clara border border-tinta disabled:opacity-50',
  secundario: 'bg-superficie text-texto border border-borde-fuerte hover:bg-fondo disabled:opacity-50',
  fantasma: 'text-texto-2 hover:bg-fondo hover:text-texto border border-transparent disabled:opacity-40',
  peligro: 'bg-critico text-white border border-critico hover:brightness-95 disabled:opacity-50',
}
const TAMANOS = { sm: 'h-8 px-2.5 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-[15px] gap-2' }

export function Boton({ variante = 'secundario', tamano = 'md', icono: Icono, cargando, children, className, ...props }) {
  return (
    <button type="button" className={cx('inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors', VARIANTES[variante], TAMANOS[tamano], className)}
      disabled={cargando || props.disabled} {...props}>
      {cargando ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : Icono ? <Icono className="size-4" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function Panel({ titulo, descripcion, acciones, children, className, cuerpo = 'p-5' }) {
  return (
    <section className={cx('rounded-xl border border-borde bg-superficie', className)}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-borde px-5 py-3.5 sm:flex-nowrap">
          <div className="min-w-0">
            {titulo && <h2 className="text-[15px] font-semibold text-texto">{titulo}</h2>}
            {descripcion && <p className="mt-0.5 text-[13px] text-texto-2">{descripcion}</p>}
          </div>
          {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
        </header>
      )}
      <div className={cuerpo}>{children}</div>
    </section>
  )
}

const TONOS = {
  neutro: 'bg-fondo text-texto-2 border-borde',
  info: 'bg-serie-1-pista text-tinta border-serie-1-claro',
  bien: 'bg-serie-1-pista text-bien-texto border-serie-1-claro',
  aviso: 'bg-[#fff6e0] text-[#7a5200] border-[#fbe2a6]',
  serio: 'bg-[#fdeee7] text-[#8f3b17] border-[#f8d3c3]',
  critico: 'bg-[#fbeaea] text-[#9e2020] border-[#f2c5c5]',
}
export function Insignia({ tono = 'neutro', children, className }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium whitespace-nowrap', TONOS[tono], className)}>{children}</span>
}

// Estado con ícono + texto: el color nunca va solo
const ESTADOS = {
  error: { tono: 'critico', icono: OctagonAlert, color: 'text-critico' },
  critico: { tono: 'critico', icono: OctagonAlert, color: 'text-critico' },
  advertencia: { tono: 'aviso', icono: TriangleAlert, color: 'text-[#b07a00]' },
  aviso: { tono: 'aviso', icono: TriangleAlert, color: 'text-[#b07a00]' },
  serio: { tono: 'serio', icono: CircleAlert, color: 'text-[#c25a2c]' },
  info: { tono: 'info', icono: Info, color: 'text-serie-1' },
  bien: { tono: 'bien', icono: CircleCheck, color: 'text-bien' },
}
export function IconoEstado({ tipo, className }) {
  const e = ESTADOS[tipo] || ESTADOS.info
  const I = e.icono
  return <I className={cx('size-4 shrink-0', e.color, className)} aria-hidden />
}
export function EtiquetaEstado({ tipo, children }) {
  const e = ESTADOS[tipo] || ESTADOS.info
  const I = e.icono
  return <Insignia tono={e.tono}><I className="size-3.5" aria-hidden />{children}</Insignia>
}

export function Cargando({ texto = 'Cargando…', className }) {
  return (
    <div className={cx('flex items-center gap-2 text-sm text-texto-2', className)} role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />{texto}
    </div>
  )
}

export function Vacio({ titulo, texto, accion, icono: Icono = Info }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-borde-fuerte bg-fondo/60 px-5 py-6">
      <Icono className="size-5 text-texto-3" aria-hidden />
      <p className="font-medium text-texto">{titulo}</p>
      {texto && <p className="max-w-prose text-sm text-texto-2">{texto}</p>}
      {accion}
    </div>
  )
}

export function MensajeError({ error, reintentar }) {
  if (!error) return null
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#f2c5c5] bg-[#fbeaea] px-4 py-3 text-sm text-[#7d1a1a]" role="alert">
      <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">{error}</div>
      {reintentar && <button type="button" className="font-medium underline" onClick={reintentar}>Reintentar</button>}
    </div>
  )
}

export function Segmentado({ opciones, valor, onCambiar, etiqueta, titulo }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-borde-fuerte bg-superficie p-0.5" role="radiogroup" aria-label={etiqueta} title={titulo}>
      {opciones.map((o) => (
        <button key={o.valor} type="button" role="radio" aria-checked={valor === o.valor} onClick={() => onCambiar(o.valor)}
          className={cx('h-7 rounded-md px-2.5 text-[13px] font-medium transition-colors',
            valor === o.valor ? 'bg-tinta text-white' : 'text-texto-2 hover:text-texto')}>
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

export const claseCampo = 'h-9 w-full rounded-lg border border-borde-fuerte bg-superficie px-3 text-sm text-texto placeholder:text-texto-3 focus:border-serie-1 focus:outline-none focus:ring-2 focus:ring-serie-1/20 disabled:bg-fondo'

export function Campo({ etiqueta, ayuda, children, className, htmlFor }) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)} htmlFor={htmlFor}>
      <span className="text-[13px] font-medium text-texto-2">{etiqueta}</span>
      {children}
      {ayuda && <span className="text-[12px] text-texto-3">{ayuda}</span>}
    </label>
  )
}

export function Pestanas({ items, activa, onCambiar, etiqueta }) {
  return (
    <div className="-mx-1 overflow-x-auto md:overflow-visible" role="tablist" aria-label={etiqueta}>
      <div className="flex min-w-max gap-1 px-1 md:min-w-0 md:flex-wrap">
        {items.map((it) => (
          <button key={it.clave} type="button" role="tab" aria-selected={activa === it.clave} onClick={() => onCambiar(it.clave)}
            className={cx('relative h-9 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors',
              activa === it.clave ? 'bg-superficie text-texto shadow-[0_0_0_1px_var(--color-borde)]' : 'text-texto-2 hover:bg-superficie/70 hover:text-texto')}>
            {it.etiqueta}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Modal({ abierto, titulo, onCerrar, children, pie, ancho = 'max-w-lg' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!abierto) return undefined
    const previo = document.activeElement
    ref.current?.querySelector('input, select, textarea, button')?.focus()
    const tecla = (e) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('keydown', tecla); previo?.focus?.() }
  }, [abierto, onCerrar])
  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#1b2420]/45 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo} className={cx('w-full rounded-xl border border-borde bg-superficie shadow-xl', ancho)}>
        <header className="flex items-center justify-between gap-4 border-b border-borde px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{titulo}</h2>
          <button type="button" onClick={onCerrar} className="rounded-md p-1 text-texto-3 hover:bg-fondo hover:text-texto" aria-label="Cerrar"><X className="size-4" /></button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="flex flex-wrap justify-end gap-2 border-t border-borde px-5 py-3">{pie}</footer>}
      </div>
    </div>
  )
}

// Medidor: la pista es un tono claro del mismo azul; pasado el 100 % se marca en rojo con ícono
export function Medidor({ valor, alto = 'h-2', className, etiqueta }) {
  const v = Math.max(0, Number(valor) || 0)
  const pasa = v > 1
  return (
    <div className={cx('relative w-full overflow-hidden rounded-full bg-serie-1-pista', alto, className)} role="meter"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={etiqueta}>
      <div className={cx('h-full rounded-full', pasa ? 'bg-critico' : 'bg-serie-1')} style={{ width: `${Math.min(v, 1) * 100}%` }} />
    </div>
  )
}
