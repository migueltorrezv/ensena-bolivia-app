import { useEffect, useState } from 'react'
import { ChevronRight, ListOrdered, OctagonAlert } from 'lucide-react'
import { DIMENSIONES, etiquetaFila } from '../lib/reportes.js'
import { num, pct, simbolo } from '../lib/formato.js'
import { cx } from './Ui.jsx'

const llave = (f) => Array.from({ length: f.nivel }, (_, i) => f[`k${i + 1}`]).join('\u0001')

// En «Por mes» el presupuesto casi todo es anual: comparar cada mes contra «su» presupuesto da
// porcentajes absurdos (el Excel muestra 72-94 %). Con el criterio real se muestra el avance acumulado.
export function columnasDe(filas, criterio, dims = []) {
  if (criterio !== 'excel' && dims.length === 1 && dims[0] === 'mes') {
    const total = filas.find((f) => f.nivel === 0)
    const anual = Number(total?.presupuesto_vigente) || 0
    const acumulado = new Map()
    let suma = 0
    for (const f of filas) {
      if (f.nivel === 1 && f.k1 !== '0') { suma += Number(f.ejecutado) || 0; acumulado.set(f, suma) }
      if (f.nivel === 0) acumulado.set(f, Number(f.ejecutado) || 0)
    }
    const acum = (f) => (acumulado.has(f) ? acumulado.get(f) : null)
    return [
      { id: 'presupuesto_vigente', titulo: 'Presupuesto del mes' },
      { id: 'ejecutado', titulo: 'Ejecutado' },
      { id: 'acumulado', titulo: 'Ejecutado acumulado', valor: acum },
      { id: 'pct_anual', titulo: '% del presupuesto anual', pct: true, valor: (f) => (acum(f) === null || !anual ? null : acum(f) / anual) },
    ]
  }
  if (criterio === 'excel') {
    return [
      { id: 'presupuesto_excel', titulo: 'Presupuesto (Excel)' },
      { id: 'ejecutado', titulo: 'Ejecutado' },
      { id: 'saldo_excel', titulo: 'Saldo (Excel)', valor: (f) => (f.presupuesto_excel == null ? null : f.presupuesto_excel - (f.ejecutado || 0)) },
      { id: 'pct_excel', titulo: '% ejecución', pct: true },
    ]
  }
  const conMods = filas.some((f) => Number(f.modificaciones || 0) !== 0)
  return [
    { id: 'presupuesto', titulo: 'Presupuesto' },
    ...(conMods ? [{ id: 'modificaciones', titulo: 'Modificaciones' }, { id: 'presupuesto_vigente', titulo: 'Vigente' }] : []),
    { id: 'ejecutado', titulo: 'Ejecutado' },
    { id: 'saldo', titulo: 'Saldo' },
    { id: 'pct_ejecucion', titulo: '% ejecución', pct: true },
  ]
}

const valorDe = (f, c) => (c.valor ? c.valor(f) : f[c.id])

function CeldaPct({ valor }) {
  if (valor === null || valor === undefined) return <span className="text-texto-3">—</span>
  const pasa = valor > 1
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={cx('num', pasa && 'font-semibold text-[#9e2020]')}>
        {pasa && <OctagonAlert className="mr-1 inline size-3.5 -translate-y-px text-critico" aria-label="Sobregiro" />}
        {pct(valor)}
      </span>
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-serie-1-pista sm:block" aria-hidden>
        <span className={cx('block h-full rounded-full', pasa ? 'bg-critico' : 'bg-serie-1')} style={{ width: `${Math.min(Math.max(valor, 0), 1) * 100}%` }} />
      </span>
    </div>
  )
}

// Tabla jerárquica: cada subtotal se pliega y despliega; el detalle se puede abrir en movimientos.
export function TablaArbol({ filas, dims, criterio = 'real', moneda = 'BS', onVerMovimientos, expandirHasta, cargando, compacta }) {
  const n = dims.length
  const hasta = expandirHasta ?? (n <= 2 ? n : 2)
  // Regla por defecto (se ve hasta el nivel "hasta") + lo que el usuario abrió o cerró a mano
  const [cambios, setCambios] = useState(() => new Map())
  const firma = dims.join(',')
  useEffect(() => { setCambios(new Map()) }, [firma, hasta])
  const cerrado = (k, nivel) => (cambios.has(k) ? cambios.get(k) : nivel >= hasta && nivel < n && nivel > 0)

  const columnas = columnasDe(filas, criterio, dims)
  const visibles = filas.filter((f) => {
    for (let i = 1; i < f.nivel; i++) {
      const ancestro = Array.from({ length: i }, (_, j) => f[`k${j + 1}`]).join('\u0001')
      if (cerrado(ancestro, i)) return false
    }
    return true
  })
  const alternar = (k, nivel) => setCambios((m) => new Map(m).set(k, !cerrado(k, nivel)))
  const encabezado = dims.map((d) => DIMENSIONES[d]?.etiqueta || d).join(' › ') || 'Concepto'

  return (
    <div className={cx('overflow-auto rounded-lg border border-borde transition-opacity', cargando && 'opacity-50', compacta ? 'max-h-[420px]' : 'max-h-[68vh]')}>
      <table className="w-full min-w-[720px] border-collapse text-[13.5px]">
        <thead className="sticky top-0 z-10 bg-[#f6f8fa] text-left text-[12.5px] text-texto-2">
          <tr className="border-b border-borde">
            <th scope="col" className="px-3 py-2.5 font-medium">{encabezado}</th>
            {columnas.map((c) => (
              <th key={c.id} scope="col" className={cx('px-3 py-2.5 text-right font-medium whitespace-nowrap', c.pct && 'w-36')}>
                {c.titulo}{!c.pct && <span className="ml-1 font-normal text-texto-3">{simbolo(moneda)}</span>}
              </th>
            ))}
            {onVerMovimientos && <th scope="col" className="w-10 px-2"><span className="sr-only">Movimientos</span></th>}
          </tr>
        </thead>
        <tbody>
          {visibles.map((f) => {
            const k = llave(f)
            const total = f.nivel === 0
            const tieneHijos = f.nivel > 0 && f.nivel < n
            const abierto = !cerrado(k, f.nivel)
            const anual = dims[f.nivel - 1] === 'mes' && f[`k${f.nivel}`] === '0'
            return (
              <tr key={k || 'total'} className={cx('group border-b border-borde/70',
                total ? 'border-t-2 border-t-borde-fuerte bg-serie-1-pista font-semibold' : f.nivel === 1 && n > 1 ? 'bg-[#fafbfc] font-medium' : tieneHijos ? 'bg-superficie font-medium' : 'bg-superficie',
                'hover:bg-serie-1-pista/40')}>
                <th scope="row" className={cx('py-2 pr-3 text-left', total ? 'font-semibold' : tieneHijos || (f.nivel === 1 && n > 1) ? 'font-medium' : 'font-normal')}
                  style={{ paddingLeft: `${12 + Math.max(f.nivel - 1, 0) * 20}px` }}>
                  <div className="flex items-center gap-1.5">
                    {tieneHijos ? (
                      <button type="button" onClick={() => alternar(k, f.nivel)} aria-expanded={abierto}
                        aria-label={`${abierto ? 'Contraer' : 'Desplegar'} ${etiquetaFila(f)}`}
                        className="-ml-1 rounded p-0.5 text-texto-3 hover:bg-fondo hover:text-texto">
                        <ChevronRight className={cx('size-4 transition-transform', abierto && 'rotate-90')} aria-hidden />
                      </button>
                    ) : (!total && n > 1 && <span className="w-4" aria-hidden />)}
                    <span className={cx('text-texto', f.nivel > 1 && !tieneHijos && 'text-texto-2')}>{etiquetaFila(f)}</span>
                  </div>
                </th>
                {columnas.map((c) => (
                  <td key={c.id} className="px-3 py-2 text-right whitespace-nowrap">
                    {c.pct ? <CeldaPct valor={valorDe(f, c)} /> : <span className="num">{num(valorDe(f, c))}</span>}
                  </td>
                ))}
                {onVerMovimientos && (
                  <td className="px-2 text-right">
                    {!anual && (
                      <button type="button" onClick={() => onVerMovimientos(f)} title="Ver los movimientos de esta fila"
                        className="rounded p-1 text-texto-3 opacity-60 group-hover:opacity-100 hover:bg-fondo hover:text-serie-1 focus:opacity-100">
                        <ListOrdered className="size-4" aria-hidden /><span className="sr-only">Ver movimientos de {etiquetaFila(f)}</span>
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
