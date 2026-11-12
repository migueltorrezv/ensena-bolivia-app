import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { MESES_CORTOS } from '../lib/formato.js'
import { useFueraDe } from '../lib/usar.js'
import { useSesion } from './Sesion.jsx'
import { claseCampo, cx } from './Ui.jsx'

export function Multi({ etiqueta, opciones, valor = [], onCambiar }) {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  useFueraDe(ref, () => setAbierto(false), abierto)
  const visibles = q ? opciones.filter((o) => o.etiqueta.toLowerCase().includes(q.toLowerCase())) : opciones
  const resumen = valor.length === 0 ? 'Todos'
    : valor.length === 1 ? (opciones.find((o) => o.valor === valor[0])?.etiqueta ?? valor[0]) : `${valor.length} elegidos`
  const alternar = (v) => onCambiar(valor.includes(v) ? valor.filter((x) => x !== v) : [...valor, v])
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto} aria-haspopup="listbox"
        className={cx('inline-flex h-9 max-w-[240px] items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
          valor.length ? 'border-serie-1/50 bg-serie-1-pista text-texto' : 'border-borde-fuerte bg-superficie text-texto-2 hover:text-texto')}>
        <span className="text-texto-2">{etiqueta}:</span>
        <span className="truncate font-medium text-texto">{resumen}</span>
        <ChevronDown className="size-3.5 shrink-0 text-texto-3" aria-hidden />
      </button>
      {abierto && (
        <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-borde bg-superficie shadow-lg">
          {opciones.length > 7 && (
            <div className="border-b border-borde p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-texto-3" aria-hidden />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar ${etiqueta.toLowerCase()}`}
                  className={cx(claseCampo, 'h-9 pl-8')} />
              </div>
            </div>
          )}
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox" aria-multiselectable="true" aria-label={etiqueta}>
            {visibles.map((o) => {
              const sel = valor.includes(o.valor)
              return (
                <li key={o.valor} role="option" aria-selected={sel}>
                  <button type="button" onClick={() => alternar(o.valor)}
                    className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-fondo">
                    <span className={cx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                      sel ? 'border-tinta bg-tinta text-white' : 'border-borde-fuerte bg-superficie')}>
                      {sel && <Check className="size-3" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="text-texto">{o.etiqueta}</span>
                  </button>
                </li>
              )
            })}
            {!visibles.length && <li className="px-3 py-2 text-sm text-texto-3">Sin coincidencias</li>}
          </ul>
          {valor.length > 0 && (
            <div className="border-t border-borde p-1.5">
              <button type="button" onClick={() => onCambiar([])} className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-texto-2 hover:bg-fondo">
                Quitar este filtro
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const VACIOS = ['financiadores', 'regiones', 'areas', 'rubros', 'cuentas']

// Una sola fila de filtros encima de todo lo que filtra.
export function BarraFiltros({ filtros, onCambiar, conTexto = false, conMeses = true }) {
  const { catalogos } = useSesion()
  const opciones = useMemo(() => {
    if (!catalogos) return null
    const rubrosElegidos = filtros.rubros || []
    return {
      financiadores: catalogos.financiadores.map((f) => ({ valor: f, etiqueta: f })),
      regiones: catalogos.regiones.map((r) => ({ valor: r.codigo, etiqueta: r.nombre })),
      areas: catalogos.areas.map((a) => ({ valor: a, etiqueta: a })),
      rubros: catalogos.rubros.map((r) => ({ valor: r.codigo, etiqueta: r.etiqueta })),
      cuentas: catalogos.cuentas
        .filter((c) => !rubrosElegidos.length || c.rubros.some((r) => rubrosElegidos.includes(r)))
        .map((c) => ({ valor: c.codigo, etiqueta: c.etiqueta })),
    }
  }, [catalogos, filtros.rubros])
  if (!opciones) return null
  const poner = (k, v) => {
    const n = { ...filtros }
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) delete n[k]
    else n[k] = v
    onCambiar(n)
  }
  const activos = VACIOS.some((k) => filtros[k]?.length) || filtros.mes_desde || filtros.mes_hasta || filtros.texto || filtros.meses
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Filtros">
      {conTexto && (
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-texto-3" aria-hidden />
          <input value={filtros.texto || ''} onChange={(e) => poner('texto', e.target.value)} placeholder="Buscar glosa o comprobante"
            className={cx(claseCampo, 'pl-9')} aria-label="Buscar en la glosa o el número de comprobante" />
        </div>
      )}
      <Multi etiqueta="Financiador" opciones={opciones.financiadores} valor={filtros.financiadores} onCambiar={(v) => poner('financiadores', v)} />
      <Multi etiqueta="Región" opciones={opciones.regiones} valor={filtros.regiones} onCambiar={(v) => poner('regiones', v)} />
      <Multi etiqueta="Área" opciones={opciones.areas} valor={filtros.areas} onCambiar={(v) => poner('areas', v)} />
      <Multi etiqueta="Rubro" opciones={opciones.rubros} valor={filtros.rubros}
        onCambiar={(v) => {
          const n = { ...filtros, rubros: v }
          if (!v.length) delete n.rubros
          if (n.cuentas && v.length) {
            const validas = new Set(catalogos.cuentas.filter((c) => c.rubros.some((r) => v.includes(r))).map((c) => c.codigo))
            n.cuentas = n.cuentas.filter((c) => validas.has(c))
            if (!n.cuentas.length) delete n.cuentas
          }
          onCambiar(n)
        }} />
      <Multi etiqueta="Cuenta" opciones={opciones.cuentas} valor={filtros.cuentas} onCambiar={(v) => poner('cuentas', v)} />
      {conMeses && (
        <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-borde-fuerte bg-superficie px-2 text-sm">
          <span className="px-1 text-texto-2">Meses</span>
          <select aria-label="Desde el mes" value={filtros.mes_desde || 1} onChange={(e) => poner('mes_desde', Number(e.target.value) === 1 ? null : Number(e.target.value))}
            className="h-7 rounded-md bg-transparent px-1 font-medium text-texto focus:outline-none">
            {MESES_CORTOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <span className="text-texto-3">a</span>
          <select aria-label="Hasta el mes" value={filtros.mes_hasta || 12} onChange={(e) => poner('mes_hasta', Number(e.target.value) === 12 ? null : Number(e.target.value))}
            className="h-7 rounded-md bg-transparent px-1 font-medium text-texto focus:outline-none">
            {MESES_CORTOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
      )}
      {filtros.meses?.length > 0 && (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-serie-1/50 bg-serie-1-pista px-3 text-sm">
          <span className="text-texto-2">Mes:</span>
          <span className="font-medium">{filtros.meses.map((m) => MESES_CORTOS[m - 1]).join(', ')}</span>
          <button type="button" onClick={() => poner('meses', null)} className="rounded p-0.5 text-texto-3 hover:text-texto" aria-label="Quitar el filtro de mes">
            <X className="size-3.5" />
          </button>
        </span>
      )}
      {activos && (
        <button type="button" onClick={() => onCambiar({})} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm text-texto-2 hover:bg-superficie hover:text-texto">
          <X className="size-4" aria-hidden />Limpiar filtros
        </button>
      )}
    </div>
  )
}
