import { useEffect, useMemo, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, FileSpreadsheet, FileText, Plus, X } from 'lucide-react'
import { BarraFiltros } from '../componentes/Filtros.jsx'
import { BarrasPresupuesto, BarrasSeries, ColumnasMes, COLORES, Leyenda } from '../componentes/Graficos.jsx'
import { useSesion } from '../componentes/Sesion.jsx'
import { columnasDe, TablaArbol } from '../componentes/TablaArbol.jsx'
import { Boton, Cargando, cx, MensajeError, Panel, Pestanas, Vacio } from '../componentes/Ui.jsx'
import { descargasBloqueadas, exportarTabla, guardarBlob } from '../lib/descargas.js'
import { dinero, MESES_CORTOS, num, pct } from '../lib/formato.js'
import { DIMENSIONES, filtrosDeFila, REPORTES } from '../lib/reportes.js'
import { filtrosDeRuta, ir, irConFiltros } from '../lib/ruta.js'
import { useConsulta } from '../lib/usar.js'

const medida = (f, criterio) => (criterio === 'excel'
  ? { base: f.presupuesto_excel, pct: f.pct_excel } : { base: f.presupuesto_vigente, pct: f.pct_ejecucion })

function useExportar() {
  const { datos, moneda, criterio, avisar } = useSesion()
  const [ocupado, setOcupado] = useState(null)
  const exportar = async ({ formato, reporte, titulo, dims, filtros, filas }) => {
    setOcupado(formato)
    try {
      if (!datos.capacidades.servidorArchivos) {
        if (descargasBloqueadas()) {
          avisar('Esta vista previa bloquea las descargas: abre la aplicación en una pestaña para exportar', 'error')
          return
        }
        const cols = columnasDe(filas, criterio, dims)
        const columnas = [
          { titulo: 'Nivel', valor: 'nivel' },
          ...dims.map((d, i) => ({ titulo: DIMENSIONES[d].etiqueta, valor: (f) => (f.nivel === 0 ? (i === 0 ? 'Total general' : '') : f.nivel > i ? f[`d${i + 1}`] : '') })),
          ...cols.map((c) => ({
            titulo: c.titulo,
            numero: !c.pct,
            pct: c.pct,
            valor: (f) => (c.valor ? c.valor(f) : f[c.id]),
          })),
        ]
        const { blob, nombre } = await exportarTabla(formato, titulo, columnas, filas)
        guardarBlob(blob, nombre)
        avisar(`Listo: ${nombre}`)
        return
      }
      const { blob, nombre } = await datos.exportar({ reporte, titulo, dimensiones: dims, filtros, moneda, criterio, formato })
      guardarBlob(blob, nombre)
      avisar(`Listo: ${nombre}`)
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setOcupado(null)
    }
  }
  return { exportar, ocupado }
}

function BotonesExportar({ alExportar, ocupado }) {
  return (
    <>
      <Boton tamano="sm" icono={FileSpreadsheet} onClick={() => alExportar('xlsx')} cargando={ocupado === 'xlsx'}>Excel</Boton>
      <Boton tamano="sm" icono={FileText} onClick={() => alExportar('pdf')} cargando={ocupado === 'pdf'}>PDF</Boton>
    </>
  )
}

function VistaArbol({ reporte, titulo, descripcion, dims, filtros, extra }) {
  const { datos, gestion, moneda, criterio, version } = useSesion()
  const [expandir, setExpandir] = useState(null)
  const consulta = useMemo(() => ({ ...filtros, gestiones: filtros.gestiones || (gestion ? [gestion] : undefined) }), [filtros, gestion])
  const { datos: filas, error, cargando } = useConsulta(
    () => datos.rpc('reporte_json', { p_dimensiones: dims, p_filtros: consulta, p_moneda: moneda }),
    [datos, dims.join(','), JSON.stringify(consulta), moneda, version])
  useEffect(() => { setExpandir(null) }, [dims.join(',')])
  const { exportar, ocupado } = useExportar()

  if (error && !filas) return <MensajeError error={error} />
  if (!filas) return <Cargando />
  const nivel1 = filas.filter((f) => f.nivel === 1)
  const total = filas.find((f) => f.nivel === 0)
  const porMes = dims[0] === 'mes'
  const vacio = !total?.movimientos && !total?.presupuesto && !total?.modificaciones

  return (
    <div className="space-y-5">
      {error && <MensajeError error={error} />}
      {extra}
      <Panel titulo={titulo} descripcion={descripcion}
        acciones={<>
          {dims.length > 1 && <>
            <Boton tamano="sm" variante="fantasma" icono={ChevronsUpDown} onClick={() => setExpandir(dims.length)}>Desplegar todo</Boton>
            <Boton tamano="sm" variante="fantasma" icono={ChevronsDownUp} onClick={() => setExpandir(1)}>Contraer</Boton>
          </>}
          <BotonesExportar ocupado={ocupado}
            alExportar={(formato) => exportar({ formato, reporte, titulo, dims, filtros: consulta, filas })} />
        </>}>
        {vacio ? <Vacio titulo="No hay datos con estos filtros" texto="Quita algún filtro o cambia de gestión." /> : (
          <div className="space-y-5">
            {nivel1.length > 1 && (porMes ? (
              <ColumnasMes moneda={moneda} datos={nivel1.filter((f) => f.k1 !== '0').map((f) => ({ corto: MESES_CORTOS[Number(f.k1) - 1], etiqueta: f.d1, valor: f.ejecutado }))} />
            ) : nivel1.length <= 14 && (
              <div>
                <Leyenda items={[{ nombre: criterio === 'excel' ? 'Presupuesto (Excel)' : 'Presupuesto vigente', color: COLORES.presupuesto }, { nombre: 'Ejecutado', color: COLORES.ejecutado }]} />
                <div className="mt-2">
                  <BarrasPresupuesto moneda={moneda} etiquetaPresupuesto={criterio === 'excel' ? 'Presupuesto (Excel)' : 'Presupuesto vigente'}
                    datos={nivel1.map((f) => ({ etiqueta: f.d1, presupuesto: medida(f, criterio).base, ejecutado: f.ejecutado, pct: medida(f, criterio).pct }))} />
                </div>
              </div>
            ))}
            <TablaArbol filas={filas} dims={dims} criterio={criterio} moneda={moneda} cargando={cargando} expandirHasta={expandir ?? undefined}
              onVerMovimientos={(f) => irConFiltros('movimientos', { ...filtros, ...filtrosDeFila(f, dims) })} />
          </div>
        )}
      </Panel>
    </div>
  )
}

function VistaResumen({ filtros }) {
  const { datos, gestion, moneda, criterio, version } = useSesion()
  const consulta = useMemo(() => ({ ...filtros, ...(gestion ? { gestiones: [gestion] } : {}) }), [filtros, gestion])
  const secciones = [
    { titulo: 'Por financiador', dims: ['financiador', 'rubro'] },
    { titulo: 'Por rubro', dims: ['rubro'] },
    { titulo: 'Por región', dims: ['region'] },
    { titulo: 'Por mes', dims: ['mes'] },
  ]
  const { datos: d, error, cargando } = useConsulta(async () => {
    const [res, ...tablas] = await Promise.all([
      datos.rpc('resumen_general', { p_filtros: consulta, p_moneda: moneda }),
      ...secciones.map((s) => datos.rpc('reporte_json', { p_dimensiones: s.dims, p_filtros: consulta, p_moneda: moneda })),
    ])
    return { res, tablas }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, JSON.stringify(consulta), moneda, version])
  const { exportar, ocupado } = useExportar()
  if (error && !d) return <MensajeError error={error} />
  if (!d) return <Cargando />
  const { res } = d
  const base = criterio === 'excel' ? res.presupuesto_excel : res.presupuesto_vigente
  const kpis = [
    ['Presupuesto', dinero(base, moneda)], ['Ejecutado', dinero(res.ejecutado, moneda)],
    ['Saldo', dinero((base || 0) - (res.ejecutado || 0), moneda)],
    ['Ejecución', pct(criterio === 'excel' ? res.pct_excel : res.pct_ejecucion)],
    ['Avance del año', `${pct(res.avance_tiempo, 0)} (${res.ultimo_mes || 0} de 12 meses)`],
  ]
  return (
    <Panel titulo="Resumen general consolidado" descripcion="Reproduce la hoja «Rubro» del Excel y la complementa con financiador, región y mes"
      acciones={<BotonesExportar ocupado={ocupado}
        alExportar={(formato) => exportar({ formato, reporte: 'resumen', titulo: 'Resumen general consolidado', dims: ['rubro'], filtros: consulta, filas: d.tablas[1] })} />}>
      <div className={cx('space-y-6 transition-opacity', cargando && 'opacity-60')}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-borde pb-5 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map(([t, v]) => (
            <div key={t}><dt className="text-[13px] text-texto-2">{t}</dt><dd className="mt-0.5 text-[17px] font-semibold">{v}</dd></div>
          ))}
        </dl>
        {secciones.map((s, i) => (
          <div key={s.titulo}>
            <h3 className="mb-2 text-sm font-semibold text-texto-2">{s.titulo}</h3>
            <TablaArbol filas={d.tablas[i]} dims={s.dims} criterio={criterio} moneda={moneda} compacta expandirHasta={1} />
          </div>
        ))}
      </div>
    </Panel>
  )
}

function VistaComparativo({ filtros }) {
  const { catalogos, datos, moneda, criterio, version } = useSesion()
  const disponibles = catalogos.gestiones.map((g) => g.anio).sort((a, b) => a - b)
  const [elegidas, setElegidas] = useState(disponibles.slice(-3))
  const [hasta, setHasta] = useState(12)
  const consulta = useMemo(() => ({ ...filtros, gestiones: elegidas, ...(hasta < 12 ? { mes_hasta: hasta } : {}) }), [filtros, elegidas, hasta])
  const { datos: filas, error } = useConsulta(
    () => (elegidas.length ? datos.rpc('reporte_json', { p_dimensiones: ['rubro', 'gestion'], p_filtros: consulta, p_moneda: moneda }) : []),
    [datos, JSON.stringify(consulta), moneda, version])

  if (disponibles.length < 2) {
    return (
      <Panel titulo="Comparativo por gestiones">
        <Vacio titulo="Para comparar hace falta más de una gestión"
          texto="Importa el Excel de otra gestión (por ejemplo 2025) desde Importar Excel, eligiendo esa gestión. El comparativo aparece aquí en cuanto haya dos." />
      </Panel>
    )
  }
  const anios = [...elegidas].sort((a, b) => a - b)
  const color = (anio) => COLORES.serie[disponibles.indexOf(anio) % 3]
  const rubros = (filas || []).filter((f) => f.nivel === 1)
  const chart = rubros.map((r) => {
    const fila = { etiqueta: r.d1 }
    for (const h of (filas || []).filter((f) => f.nivel === 2 && f.k1 === r.k1)) fila[`g${h.k2}`] = h.ejecutado
    return fila
  })
  const dos = anios.length === 2
  return (
    <div className="space-y-5">
      {error && <MensajeError error={error} />}
      <Panel titulo="Comparativo por gestiones" descripcion="Ejecución por rubro en cada gestión. Para comparar periodos iguales, limita los meses.">
        <div className="mb-5 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-texto-2">Gestiones</span>
          {disponibles.map((a) => (
            <label key={a} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={elegidas.includes(a)} onChange={() => setElegidas((e) => (e.includes(a) ? e.filter((x) => x !== a) : [...e, a]))} className="size-4 accent-tinta" />
              {a}
            </label>
          ))}
          <span className="ml-4 text-texto-2">Hasta</span>
          <select value={hasta} onChange={(e) => setHasta(Number(e.target.value))} className="h-8 rounded-lg border border-borde-fuerte bg-superficie px-2">
            {MESES_CORTOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        {!filas ? <Cargando /> : (
          <div className="space-y-5">
            {anios.length > 3 && <p className="text-sm text-texto-2">El gráfico muestra hasta tres gestiones; la tabla las tiene todas.</p>}
            <Leyenda items={anios.slice(-3).map((a) => ({ nombre: String(a), color: color(a) }))} />
            <BarrasSeries moneda={moneda} datos={chart} series={anios.slice(-3).map((a) => ({ clave: `g${a}`, nombre: `Ejecutado ${a}`, color: color(a) }))} />
            {dos && (
              <div className="overflow-auto rounded-lg border border-borde">
                <table className="w-full min-w-[560px] text-[13.5px]">
                  <thead className="bg-[#f6f8fa] text-[12.5px] text-texto-2">
                    <tr><th scope="col" className="px-3 py-2 text-left font-medium">Rubro</th>
                      {anios.map((a) => <th key={a} scope="col" className="px-3 py-2 text-right font-medium">Ejecutado {a}</th>)}
                      <th scope="col" className="px-3 py-2 text-right font-medium">Variación</th></tr>
                  </thead>
                  <tbody>
                    {chart.map((r) => {
                      const a = r[`g${anios[0]}`] || 0
                      const b = r[`g${anios[1]}`] || 0
                      return (
                        <tr key={r.etiqueta} className="border-t border-borde/70">
                          <th scope="row" className="px-3 py-2 text-left font-normal">{r.etiqueta}</th>
                          <td className="num px-3 py-2 text-right">{num(a)}</td>
                          <td className="num px-3 py-2 text-right">{num(b)}</td>
                          <td className="num px-3 py-2 text-right">{a ? `${b >= a ? '+' : '−'}${pct(Math.abs(b - a) / a)}` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <TablaArbol filas={filas} dims={['rubro', 'gestion']} criterio={criterio} moneda={moneda} />
          </div>
        )}
      </Panel>
    </div>
  )
}

function ElegirDimensiones({ dims, onCambiar }) {
  const libres = Object.keys(DIMENSIONES).filter((d) => !dims.includes(d))
  return (
    <Panel titulo="Arma tu consulta" descripcion="Elige las dimensiones en el orden en que quieres desplegarlas (hasta 6). El reporte se arma solo.">
      <div className="flex flex-wrap items-center gap-2">
        {dims.map((d, i) => (
          <span key={d} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-tinta pr-1 pl-3 text-sm text-white">
            <span className="text-white/60">{i + 1}.</span>{DIMENSIONES[d].etiqueta}
            <button type="button" onClick={() => onCambiar(dims.filter((x) => x !== d))} className="rounded p-1 text-white/70 hover:bg-white/15 hover:text-white" aria-label={`Quitar ${DIMENSIONES[d].etiqueta}`}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {dims.length < 6 && libres.map((d) => (
          <button key={d} type="button" onClick={() => onCambiar([...dims, d])}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-borde-fuerte px-2.5 text-sm text-texto-2 hover:border-serie-1 hover:text-texto">
            <Plus className="size-3.5" aria-hidden />{DIMENSIONES[d].etiqueta}
          </button>
        ))}
      </div>
    </Panel>
  )
}

export default function Reportes({ ruta }) {
  const clave = ruta.partes[1] || 'rubro-cuenta'
  const rep = REPORTES.find((r) => r.clave === clave) || REPORTES[0]
  const f = ruta.params.get('f')
  const [filtros, setFiltros] = useState(() => filtrosDeRuta(ruta.params))
  useEffect(() => { setFiltros(filtrosDeRuta(ruta.params)) }, [f]) // eslint-disable-line react-hooks/exhaustive-deps
  const [dimsLibres, setDimsLibres] = useState(['financiador', 'area', 'rubro'])

  // Al cambiar de pestaña los filtros viajan en la dirección, así no se pierden
  const cambiar = (c) => {
    const destino = c === 'movimientos' ? 'movimientos' : `reportes/${c}`
    if (Object.keys(filtros).length) irConFiltros(destino, filtros)
    else ir(destino)
  }
  const { gestiones: _g, ...filtrosBarra } = filtros
  let vista
  if (rep.clave === 'resumen') vista = <VistaResumen filtros={filtrosBarra} />
  else if (rep.clave === 'comparativo') vista = <VistaComparativo filtros={filtrosBarra} />
  else if (rep.clave === 'libre') {
    vista = dimsLibres.length ? (
      <VistaArbol titulo="Consulta dinámica" descripcion={dimsLibres.map((d) => DIMENSIONES[d].etiqueta).join(' › ')}
        dims={dimsLibres} filtros={filtrosBarra} extra={<ElegirDimensiones dims={dimsLibres} onCambiar={setDimsLibres} />} />
    ) : <ElegirDimensiones dims={dimsLibres} onCambiar={setDimsLibres} />
  } else {
    vista = <VistaArbol reporte={rep.clave} titulo={rep.largo} descripcion={`Reproduce la hoja «${rep.hoja}» del Excel, con los niveles desplegables`} dims={rep.dims} filtros={filtrosBarra} />
  }

  return (
    <div className="space-y-5">
      <Pestanas etiqueta="Reportes" activa={rep.clave} onCambiar={cambiar} items={REPORTES.map((r) => ({ clave: r.clave, etiqueta: r.titulo }))} />
      <BarraFiltros filtros={filtrosBarra} onCambiar={setFiltros} />
      {vista}
      <p className="text-[12.5px] text-texto-3">
        Toca el ícono de lista al final de una fila para ver sus movimientos. «Como el Excel» (arriba) muestra las columnas de las tablas dinámicas originales.
      </p>
    </div>
  )
}

