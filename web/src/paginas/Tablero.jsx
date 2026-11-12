import { useMemo, useState } from 'react'
import { FileUp, Table2 } from 'lucide-react'
import { BarraSegmentada, ColumnasMes, COLORES, LineaAcumulada, Leyenda } from '../componentes/Graficos.jsx'
import { BarraFiltros } from '../componentes/Filtros.jsx'
import { useSesion } from '../componentes/Sesion.jsx'
import { Boton, Cargando, cx, EtiquetaEstado, IconoEstado, Medidor, MensajeError, Panel, Vacio } from '../componentes/Ui.jsx'
import { dinero, entero, haceCuanto, MESES, MESES_CORTOS, num, pct } from '../lib/formato.js'
import { ir, irConFiltros } from '../lib/ruta.js'
import { useConsulta } from '../lib/usar.js'

const medida = (f, criterio) => (criterio === 'excel'
  ? { base: f?.presupuesto_excel, pct: f?.pct_excel }
  : { base: f?.presupuesto_vigente, pct: f?.pct_ejecucion })

const TIPO_ALERTA = { sobregiro: 'critico', 'cerca del límite': 'aviso', 'gasto sin presupuesto': 'serio' }

// La pieza central: cuánto se ejecutó contra cuánto del año ya pasó
function Ritmo({ valor, avance, ultimoMes }) {
  const v = Math.max(0, Number(valor) || 0)
  const a = Math.min(Math.max(Number(avance) || 0, 0), 1)
  return (
    <div className="mt-7">
      <div className="relative pt-7">
        {ultimoMes ? (
          <div className="absolute top-0 -translate-x-1/2 text-[12.5px] whitespace-nowrap text-texto-2" style={{ left: `${Math.min(Math.max(a * 100, 12), 88)}%` }}>
            {MESES[ultimoMes - 1]}: {pct(a, 0)} del año
          </div>
        ) : null}
        <div className="relative h-4 rounded-full bg-serie-1-pista">
          <div className={cx('h-full rounded-full', v > 1 ? 'bg-critico' : 'bg-serie-1')} style={{ width: `${Math.min(v, 1) * 100}%` }} />
          {ultimoMes ? <div className="absolute -top-2 h-8 w-0.5 rounded bg-tinta" style={{ left: `calc(${a * 100}% - 1px)` }} aria-hidden /> : null}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-texto-3"><span>0 %</span><span>100 % del presupuesto</span></div>
    </div>
  )
}

function Medidores({ filas, criterio, moneda, onElegir }) {
  if (!filas.length) return <p className="text-sm text-texto-3">Sin datos para este filtro.</p>
  return (
    <ul className="space-y-3.5">
      {filas.map((f) => {
        const m = medida(f, criterio)
        return (
          <li key={f.k1}>
            <button type="button" onClick={() => onElegir(f)} className="w-full rounded-md text-left hover:bg-fondo/70 focus-visible:bg-fondo/70">
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium text-texto">{f.d1}</span>
                <span className="num shrink-0 font-semibold">{m.pct > 1 && <IconoEstado tipo="critico" className="mr-1 inline -translate-y-px" />}{pct(m.pct)}</span>
              </div>
              <Medidor valor={m.pct} etiqueta={`${f.d1}: ${pct(m.pct)} ejecutado`} />
              <p className="mt-1 text-[12.5px] text-texto-2"><span className="num">{dinero(f.ejecutado, moneda)}</span> de <span className="num">{dinero(m.base, moneda)}</span></p>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function TablaChica({ filas, moneda, columnas }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-borde">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-[#f6f8fa] text-texto-2"><tr>{columnas.map((c) => <th key={c.id} scope="col" className={cx('px-3 py-2 font-medium', c.num ? 'text-right' : 'text-left')}>{c.titulo}</th>)}</tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-borde/70">
              {columnas.map((c) => <td key={c.id} className={cx('px-3 py-1.5', c.num && 'num text-right')}>{c.num ? num(f[c.id]) : f[c.id]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sr-only">Montos en {moneda === 'USD' ? 'dólares' : 'bolivianos'}</p>
    </div>
  )
}

export default function Tablero() {
  const { datos, gestion, moneda, criterio, version, puede } = useSesion()
  const [filtros, setFiltros] = useState({})
  const [verTabla, setVerTabla] = useState({})
  const consulta = useMemo(() => ({ ...filtros, ...(gestion ? { gestiones: [gestion] } : {}) }), [filtros, gestion])

  const { datos: d, error, cargando } = useConsulta(async () => {
    const r = (dims) => datos.rpc('reporte_json', { p_dimensiones: dims, p_filtros: consulta, p_moneda: moneda })
    const [resumen, alertas, fin, rub, reg] = await Promise.all([
      datos.rpc('resumen_general', { p_filtros: consulta, p_moneda: moneda }),
      datos.rpc('alertas_ejecucion', { p_filtros: consulta, p_umbral: 0.8 }),
      r(['financiador']), r(['rubro']), r(['region']),
    ])
    const nivel1 = (xs) => xs.filter((x) => x.nivel === 1)
    return { resumen, alertas, fin: nivel1(fin), rub: nivel1(rub), reg: nivel1(reg), total: fin.find((x) => x.nivel === 0) }
  }, [datos, consulta, moneda, version])

  if (error && !d) return <MensajeError error={error} />
  if (!d) return <Cargando />

  const { resumen: res, total } = d
  const m = medida(total, criterio)
  const otro = criterio === 'excel' ? { nombre: 'Con el presupuesto real', v: total.pct_ejecucion } : { nombre: 'Según el Excel', v: total.pct_excel }
  const brecha = (Number(m.pct) || 0) - (Number(res.avance_tiempo) || 0)
  const sinDatos = !total.movimientos && !total.presupuesto

  const ultimo = res.ultimo_mes || 0
  const porMes = new Map((res.por_mes || []).map((x) => [x.mes, x.ejecutado]))
  let suma = 0
  const serieMes = MESES_CORTOS.map((corto, i) => {
    const mes = i + 1
    suma += porMes.get(mes) || 0
    return {
      mes, corto, etiqueta: MESES[i], valor: porMes.get(mes) ?? (mes <= ultimo ? 0 : null),
      acumulado: mes <= ultimo ? suma : null, ideal: ((Number(m.base) || 0) * mes) / 12,
    }
  })
  const aReporte = (clave, f) => irConFiltros(`reportes/${clave}`, f)

  return (
    <div className={cx('space-y-5 transition-opacity', cargando && 'opacity-60')}>
      <BarraFiltros filtros={filtros} onCambiar={setFiltros} />
      {error && <MensajeError error={error} />}

      {sinDatos ? (
        <Vacio titulo={gestion ? `La gestión ${gestion} todavía no tiene datos` : 'Todavía no hay datos'} icono={FileUp}
          texto="Importa el Excel que exporta el sistema contable: el tablero se arma solo con lo que traiga."
          accion={puede.importar && <Boton variante="primario" icono={FileUp} onClick={() => ir('importar')} className="mt-2">Importar Excel</Boton>} />
      ) : (
        <>
          <section className="rounded-xl border border-borde bg-superficie px-6 pt-6 pb-5" aria-label="Ritmo de ejecución">
            <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
              <div>
                <p className="text-sm text-texto-2">Ejecutado en {gestion}{ultimo ? `, hasta ${MESES[ultimo - 1].toLowerCase()}` : ''}</p>
                <p className="mt-1 text-[52px] leading-none font-semibold tracking-tight">{pct(m.pct)}</p>
                <p className="mt-2.5 text-[15px] text-texto-2">
                  <span className="font-medium text-texto">{dinero(total.ejecutado, moneda)}</span> de {dinero(m.base, moneda)}
                  {criterio === 'excel' ? ' (criterio del Excel)' : ' de presupuesto vigente'}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-10 gap-y-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-texto-2">Saldo por ejecutar</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold">{dinero(Number(m.base || 0) - Number(total.ejecutado || 0), moneda)}</dd>
                </div>
                <div>
                  <dt className="text-texto-2">Frente al calendario</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 text-[17px] font-semibold">
                    {ultimo > 0 && brecha < -0.15 && <IconoEstado tipo="aviso" />}
                    {ultimo ? `${brecha < 0 ? '−' : '+'}${num(Math.abs(brecha) * 100, 1)} puntos` : '—'}
                  </dd>
                  {ultimo > 0 && <dd className="text-[12.5px] text-texto-2">{brecha < -0.15 ? 'Subejecución' : brecha > 0.1 ? 'Por encima del ritmo' : 'En ritmo'}</dd>}
                </div>
                <div>
                  <dt className="text-texto-2">{otro.nombre}</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold">{pct(otro.v)}</dd>
                </div>
              </dl>
            </div>
            <Ritmo valor={m.pct} avance={res.avance_tiempo} ultimoMes={ultimo} />
          </section>

          <section className="grid grid-cols-2 divide-borde rounded-xl border border-borde bg-superficie md:grid-cols-4 md:divide-x" aria-label="Datos generales">
            {[
              { t: 'Movimientos', v: entero(total.movimientos || 0), s: `${entero(d.rub.length)} rubros con datos` },
              { t: 'Modificaciones', v: dinero(total.modificaciones || 0, moneda), s: 'Sobre el presupuesto inicial', ir: () => ir('modificaciones') },
              { t: 'Cuentas en alerta', v: entero(d.alertas.length), s: 'Desde el 80 % ejecutado', estado: d.alertas.length ? 'aviso' : null },
              { t: 'Última importación', v: res.ultima_importacion ? haceCuanto(res.ultima_importacion.aplicado) : 'Ninguna', s: res.ultima_importacion?.archivo || 'Sube el Excel para empezar', ir: () => ir('importar') },
            ].map((x) => (
              <div key={x.t} className="border-borde px-5 py-4 [&:nth-child(-n+2)]:border-b md:[&:nth-child(-n+2)]:border-b-0">
                <p className="text-[13px] text-texto-2">{x.t}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[17px] font-semibold">{x.estado && <IconoEstado tipo={x.estado} />}{x.v}</p>
                <p className="truncate text-[12.5px] text-texto-3" title={x.s}>{x.s}</p>
              </div>
            ))}
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel titulo="Ejecución acumulada" descripcion="Gasto acumulado contra el ritmo parejo que llega al 100 % en diciembre"
              acciones={<Boton tamano="sm" variante="fantasma" icono={Table2} onClick={() => setVerTabla((v) => ({ ...v, acum: !v.acum }))}>{verTabla.acum ? 'Ver gráfico' : 'Ver tabla'}</Boton>}>
              {verTabla.acum
                ? <TablaChica moneda={moneda} filas={serieMes.filter((x) => x.mes <= Math.max(ultimo, 1))} columnas={[{ id: 'etiqueta', titulo: 'Mes' }, { id: 'acumulado', titulo: 'Ejecutado acumulado', num: true }, { id: 'ideal', titulo: 'Ritmo al 100 %', num: true }]} />
                : <>
                  <Leyenda items={[{ nombre: 'Ejecutado acumulado', color: COLORES.ejecutado, tipo: 'linea' }, { nombre: 'Ritmo para llegar al 100 %', color: COLORES.referencia, tipo: 'punteada' }]} />
                  <div className="mt-3"><LineaAcumulada datos={serieMes} moneda={moneda} /></div>
                </>}
            </Panel>
            <Panel titulo="Gasto por mes" descripcion="Ejecución registrada en cada mes contable"
              acciones={<Boton tamano="sm" variante="fantasma" icono={Table2} onClick={() => setVerTabla((v) => ({ ...v, mes: !v.mes }))}>{verTabla.mes ? 'Ver gráfico' : 'Ver tabla'}</Boton>}>
              {verTabla.mes
                ? <TablaChica moneda={moneda} filas={serieMes.filter((x) => x.valor !== null)} columnas={[{ id: 'etiqueta', titulo: 'Mes' }, { id: 'valor', titulo: 'Ejecutado', num: true }]} />
                : <ColumnasMes datos={serieMes.filter((x) => x.mes <= Math.max(ultimo, 1))} moneda={moneda} />}
            </Panel>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel titulo="Por financiador" descripcion="Toca uno para ver su reporte">
              <Medidores filas={d.fin} criterio={criterio} moneda={moneda} onElegir={(f) => aReporte('financiador', { financiadores: [f.k1] })} />
            </Panel>
            <Panel titulo="Por rubro" descripcion="Toca uno para ver sus cuentas">
              <Medidores filas={d.rub} criterio={criterio} moneda={moneda} onElegir={(f) => aReporte('rubro-cuenta', { rubros: [f.k1] })} />
            </Panel>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Panel titulo="Gasto por región" descripcion="Parte de lo ejecutado que corresponde a cada región">
              <BarraSegmentada partes={d.reg.map((r) => ({ etiqueta: r.d1, valor: r.ejecutado || 0 }))} moneda={moneda} />
              <div className="mt-6">
                <Medidores filas={d.reg} criterio={criterio} moneda={moneda} onElegir={(r) => aReporte('region', { regiones: [r.k1] })} />
              </div>
            </Panel>
            <Panel titulo="Alertas de ejecución" descripcion="Cuentas por financiador desde el 80 % ejecutado, sobregiradas o con gasto sin presupuesto" cuerpo="p-0">
              {d.alertas.length === 0 ? <p className="px-5 py-4 text-sm text-texto-2">Ninguna cuenta pasa el 80 % en este filtro.</p> : (
                <ul className="divide-y divide-borde">
                  {d.alertas.map((a) => (
                    <li key={`${a.financiador}-${a.rubro}-${a.cuenta}`}>
                      <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-fondo/70"
                        onClick={() => irConFiltros('movimientos', { financiadores: [a.financiador], rubros: [a.rubro], cuentas: [a.cuenta] })}>
                        <EtiquetaEstado tipo={TIPO_ALERTA[a.alerta]}>{a.alerta[0].toUpperCase() + a.alerta.slice(1)}</EtiquetaEstado>
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{a.cuenta_etiqueta}</span>
                          <span className="text-texto-2"> en {a.financiador}</span>
                        </span>
                        <span className="num text-sm font-semibold">{pct(a.pct_ejecucion)}</span>
                        <span className="num w-full text-[12.5px] text-texto-2 sm:w-auto">{dinero(a.ejecutado)} de {dinero(a.presupuesto_vigente)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
