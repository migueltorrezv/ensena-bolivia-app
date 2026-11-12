import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { compacto, dinero, pct } from '../lib/formato.js'

// Paleta validada (orden fijo, nunca se recicla) y tonos de la misma familia para presupuesto/ejecutado
export const COLORES = {
  serie: ['#26A567', '#417545', '#659184'],
  presupuesto: '#a8dfc3',
  ejecutado: '#26A567',
  referencia: '#919090',
  rejilla: '#e2e6e4',
  eje: '#c5cdc9',
  tinta: '#659184',
}
const ejeX = { tick: { fill: COLORES.tinta, fontSize: 12 }, axisLine: { stroke: COLORES.eje }, tickLine: false }
const ejeY = { tick: { fill: COLORES.tinta, fontSize: 12 }, axisLine: false, tickLine: false }
const recortar = (t, n = 26) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t)

export function Leyenda({ items }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-texto-2">
      {items.map((it) => (
        <li key={it.nombre} className="inline-flex items-center gap-1.5">
          {it.tipo === 'linea' || it.tipo === 'punteada'
            ? <svg width="18" height="8" aria-hidden><line x1="1" y1="4" x2="17" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.tipo === 'punteada' ? '4 3' : undefined} strokeLinecap="round" /></svg>
            : <span className="inline-block h-2.5 w-3 rounded-[3px]" style={{ background: it.color }} aria-hidden />}
          {it.nombre}
        </li>
      ))}
    </ul>
  )
}

// Tooltip: el valor manda, la serie acompaña
function Contenido({ active, payload, label, moneda, extra }) {
  if (!active || !payload?.length) return null
  const nombre = payload[0]?.payload?.etiqueta ?? label
  return (
    <div className="min-w-44 rounded-lg border border-borde bg-superficie px-3 py-2 text-[13px] shadow-md">
      <p className="mb-1 text-texto-2">{nombre}</p>
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <svg width="12" height="6" aria-hidden><line x1="0" y1="3" x2="12" y2="3" stroke={p.color} strokeWidth="2.5" strokeLinecap="round" /></svg>
          <span className="num font-semibold text-texto">{dinero(p.value, moneda)}</span>
          <span className="text-texto-2">{p.name}</span>
        </div>
      ))}
      {extra && extra(payload[0]?.payload)}
    </div>
  )
}

// Presupuesto vs ejecutado por categoría (barras horizontales para que los nombres largos se lean)
export function BarrasPresupuesto({ datos, moneda = 'BS', onElegir, etiquetaPresupuesto = 'Presupuesto vigente' }) {
  const alto = Math.max(140, datos.length * 44 + 36)
  return (
    <div style={{ height: alto }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid horizontal={false} stroke={COLORES.rejilla} />
          <XAxis type="number" {...ejeX} tickFormatter={compacto} />
          <YAxis type="category" dataKey="etiqueta" width={176} {...ejeY} tickFormatter={(t) => recortar(t)} />
          <Tooltip cursor={{ fill: '#e6f5ed' }} content={<Contenido moneda={moneda}
            extra={(d) => d && <p className="mt-1 border-t border-borde pt-1 text-texto-2">Ejecución <span className="num font-semibold text-texto">{pct(d.pct)}</span></p>} />} />
          <Bar dataKey="presupuesto" name={etiquetaPresupuesto} fill={COLORES.presupuesto} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false}
            onClick={onElegir ? (d) => onElegir(d.payload ?? d) : undefined} cursor={onElegir ? 'pointer' : undefined} />
          <Bar dataKey="ejecutado" name="Ejecutado" fill={COLORES.ejecutado} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false}
            onClick={onElegir ? (d) => onElegir(d.payload ?? d) : undefined} cursor={onElegir ? 'pointer' : undefined} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Varias series del mismo tipo (p. ej. una por gestión en el comparativo)
export function BarrasSeries({ datos, series, moneda = 'BS' }) {
  const alto = Math.max(140, datos.length * (series.length * 14 + 22) + 36)
  return (
    <div style={{ height: alto }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barGap={2} barCategoryGap="20%">
          <CartesianGrid horizontal={false} stroke={COLORES.rejilla} />
          <XAxis type="number" {...ejeX} tickFormatter={compacto} />
          <YAxis type="category" dataKey="etiqueta" width={176} {...ejeY} tickFormatter={(t) => recortar(t)} />
          <Tooltip cursor={{ fill: '#e6f5ed' }} content={<Contenido moneda={moneda} />} />
          {series.map((s) => (
            <Bar key={s.clave} dataKey={s.clave} name={s.nombre} fill={s.color} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ColumnasMes({ datos, moneda = 'BS', nombre = 'Ejecutado' }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COLORES.rejilla} />
          <XAxis dataKey="corto" {...ejeX} />
          <YAxis {...ejeY} width={64} tickFormatter={compacto} />
          <Tooltip cursor={{ fill: '#e6f5ed' }} content={<Contenido moneda={moneda} />} />
          <Bar dataKey="valor" name={nombre} fill={COLORES.ejecutado} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function LineaAcumulada({ datos, moneda = 'BS' }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={COLORES.rejilla} />
          <XAxis dataKey="corto" {...ejeX} />
          <YAxis {...ejeY} width={64} tickFormatter={compacto} />
          <Tooltip cursor={{ stroke: COLORES.eje }} content={<Contenido moneda={moneda} />} />
          <Line type="linear" dataKey="ideal" name="Ritmo para llegar al 100 %" stroke={COLORES.referencia} strokeWidth={1.5}
            strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />
          <Line type="linear" dataKey="acumulado" name="Ejecutado acumulado" stroke={COLORES.ejecutado} strokeWidth={2}
            dot={{ r: 4, fill: COLORES.ejecutado, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
            connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// Un total partido en sus partes (≤ 3 partes con la paleta validada; el resto se agrupa)
export function BarraSegmentada({ partes, moneda = 'BS' }) {
  const total = partes.reduce((s, p) => s + Math.max(p.valor || 0, 0), 0)
  if (!total) return <p className="text-sm text-texto-3">Sin ejecución en este filtro.</p>
  const visibles = partes.length > 3 ? [...partes.slice(0, 2), { etiqueta: 'Otras', valor: partes.slice(2).reduce((s, p) => s + p.valor, 0) }] : partes
  return (
    <div>
      <div className="flex h-7 w-full gap-0.5" role="img" aria-label={visibles.map((p) => `${p.etiqueta}: ${pct(p.valor / total)}`).join(', ')}>
        {visibles.map((p, i) => {
          const share = Math.max(p.valor, 0) / total
          if (!share) return null
          return (
            <div key={p.etiqueta} className="flex h-full items-center overflow-hidden rounded px-2 text-[12.5px] font-medium text-white"
              style={{ width: `${share * 100}%`, background: COLORES.serie[i] }} title={`${p.etiqueta}: ${dinero(p.valor, moneda)} (${pct(share)})`}>
              {share > 0.12 && <span className="num whitespace-nowrap">{pct(share, 0)}</span>}
            </div>
          )
        })}
      </div>
      <div className="mt-2.5"><Leyenda items={visibles.map((p, i) => ({ nombre: p.etiqueta, color: COLORES.serie[i] }))} /></div>
    </div>
  )
}
