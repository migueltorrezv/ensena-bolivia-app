import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText } from 'lucide-react'
import { BarraFiltros } from '../componentes/Filtros.jsx'
import { useSesion } from '../componentes/Sesion.jsx'
import { Boton, Cargando, cx, MensajeError, Panel, Vacio } from '../componentes/Ui.jsx'
import { descargasBloqueadas, exportarTabla, guardarBlob } from '../lib/descargas.js'
import { dinero, entero, fecha, MESES, num, simbolo } from '../lib/formato.js'
import { filtrosDeRuta } from '../lib/ruta.js'
import { useConsulta, useDiferido } from '../lib/usar.js'

const POR_PAGINA = 50

export default function Movimientos({ ruta }) {
  const { datos, gestion, moneda, version, avisar } = useSesion()
  const f = ruta.params.get('f')
  const [filtros, setFiltros] = useState(() => filtrosDeRuta(ruta.params))
  useEffect(() => { setFiltros(filtrosDeRuta(ruta.params)) }, [f]) // eslint-disable-line react-hooks/exhaustive-deps
  const [pagina, setPagina] = useState(0)
  const [abierto, setAbierto] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  const texto = useDiferido(filtros.texto || '')
  const { gestiones: _g, incluir_anual: _a, ...filtrosBarra } = filtros
  const consulta = useMemo(() => {
    const { texto: _t, ...resto } = filtrosBarra
    return { ...resto, ...(texto ? { texto } : {}), ...(gestion ? { gestiones: [gestion] } : {}) }
  }, [JSON.stringify(filtrosBarra), texto, gestion]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPagina(0) }, [JSON.stringify(consulta)]) // eslint-disable-line react-hooks/exhaustive-deps

  const { datos: filas, error, cargando } = useConsulta(
    () => datos.rpc('detalle_movimientos', { p_filtros: consulta, p_limite: POR_PAGINA, p_desplazamiento: pagina * POR_PAGINA }),
    [datos, JSON.stringify(consulta), pagina, version])
  const { datos: tot } = useConsulta(
    () => (consulta.texto ? null : datos.rpc('reporte_json', { p_dimensiones: [], p_filtros: { ...consulta, incluir_anual: false }, p_moneda: moneda })),
    [datos, JSON.stringify(consulta), moneda, version])

  const total = filas?.[0]?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const usd = moneda === 'USD'

  const exportar = async (formato) => {
    setOcupado(formato)
    try {
      if (!datos.capacidades.servidorArchivos) {
        if (descargasBloqueadas()) {
          avisar('Esta vista previa bloquea las descargas: abre la aplicación en una pestaña para exportar', 'error')
          return
        }
        const todas = await datos.rpc('detalle_movimientos', { p_filtros: consulta, p_limite: 50000, p_desplazamiento: 0 })
        const columnas = [
          { titulo: 'Fecha', valor: (m) => fecha(m.fecha) }, { titulo: 'Mes', valor: (m) => MESES[m.mes - 1] },
          { titulo: 'Tipo', valor: 'tipo' }, { titulo: 'Nro', valor: 'numero' }, { titulo: 'Financiador', valor: 'financiador' },
          { titulo: 'Región', valor: 'region' }, { titulo: 'Área', valor: 'area' }, { titulo: 'Rubro', valor: 'rubro_etiqueta' },
          { titulo: 'Cuenta', valor: 'cuenta_etiqueta' }, { titulo: 'Cuenta contable', valor: 'cuenta_contable' },
          { titulo: 'Nombre contable', valor: 'nombre_contable' }, { titulo: 'Glosa', valor: 'ref' },
          { titulo: 'Ejecutado Bs', valor: 'ejecutado_bs', numero: true },
          { titulo: 'Ejecutado USD', valor: 'ejecutado_usd', numero: true },
          { titulo: 'Tasa', valor: 'tasa', numero: true },
        ]
        const { blob, nombre } = await exportarTabla(formato, 'Detalle de movimientos', columnas, todas)
        guardarBlob(blob, nombre)
        avisar(`Listo: ${nombre}`)
      } else {
        const { blob, nombre } = await datos.exportar({ reporte: 'movimientos', filtros: consulta, moneda, formato })
        guardarBlob(blob, nombre)
        avisar(`Listo: ${nombre}`)
      }
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  const totalFiltro = tot?.[0]
  return (
    <div className="space-y-5">
      <BarraFiltros filtros={filtrosBarra} onCambiar={setFiltros} conTexto />
      {error && <MensajeError error={error} />}
      <Panel titulo={filas ? `${entero(total)} movimientos` : 'Movimientos'}
        descripcion={totalFiltro && !consulta.texto && totalFiltro.ejecutado != null ? `Suman ${dinero(totalFiltro.ejecutado, moneda)} en la gestión ${gestion}` : `Gestión ${gestion}`}
        acciones={<>
          <Boton tamano="sm" icono={FileSpreadsheet} onClick={() => exportar('xlsx')} cargando={ocupado === 'xlsx'}>Excel</Boton>
          <Boton tamano="sm" icono={FileText} onClick={() => exportar('pdf')} cargando={ocupado === 'pdf'}>PDF</Boton>
        </>}
        cuerpo="p-0">
        {!filas ? <div className="p-5"><Cargando /></div> : !filas.length ? (
          <div className="p-5"><Vacio titulo="Ningún movimiento coincide" texto="Prueba con otra búsqueda o quita filtros." /></div>
        ) : (
          <>
            <div className={cx('overflow-x-auto transition-opacity', cargando && 'opacity-50')}>
              <table className="w-full min-w-[900px] text-[13.5px]">
                <thead className="bg-[#f6f8fa] text-left text-[12.5px] text-texto-2">
                  <tr className="border-b border-borde">
                    <th scope="col" className="px-4 py-2.5 font-medium">Fecha</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Financiador</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Rubro y cuenta</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Glosa</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Ejecutado <span className="font-normal text-texto-3">{simbolo(moneda)}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((m) => (
                    <Fragment key={m.id}>
                      <tr className="cursor-pointer border-b border-borde/70 align-top hover:bg-serie-1-pista/40 focus-visible:bg-serie-1-pista/40" tabIndex={0}
                        onClick={() => setAbierto(abierto === m.id ? null : m.id)} aria-expanded={abierto === m.id}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAbierto(abierto === m.id ? null : m.id) } }}>
                        <td className="num px-4 py-2.5 whitespace-nowrap text-texto-2">{fecha(m.fecha)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{m.financiador}<span className="block text-[12px] text-texto-3">{m.region} · {m.area}</span></td>
                        <td className="px-3 py-2.5">{m.cuenta_etiqueta}<span className="block text-[12px] text-texto-3">{m.rubro_etiqueta}</span></td>
                        <td className="px-3 py-2.5 text-texto-2"><span className="line-clamp-2">{m.ref}</span></td>
                        <td className="num px-4 py-2.5 text-right font-medium whitespace-nowrap">{num(usd ? m.ejecutado_usd : m.ejecutado_bs)}</td>
                      </tr>
                      {abierto === m.id && (
                        <tr className="border-b border-borde bg-[#f9fbfd]">
                          <td colSpan={5} className="px-4 py-3">
                            <dl className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                              {[
                                ['Comprobante', `Tipo ${m.tipo ?? '—'} · Nro. ${m.numero ?? '—'}`],
                                ['Cuenta contable', `${m.cuenta_contable ?? '—'} ${m.nombre_contable ?? ''}`],
                                ['Debe / Haber', `Bs ${num(m.debe_bs)} / Bs ${num(m.haber_bs)}`],
                                ['En dólares', `US$ ${num(m.ejecutado_usd)} (tasa ${m.tasa ? num(m.tasa, 2) : '—'})`],
                              ].map(([t, v]) => <div key={t}><dt className="text-texto-3">{t}</dt><dd className="text-texto">{v}</dd></div>)}
                              <div className="sm:col-span-2 lg:col-span-4"><dt className="text-texto-3">Glosa completa</dt><dd className="text-texto">{m.ref}</dd></div>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-borde px-4 py-3 text-sm text-texto-2">
              <span>Página {pagina + 1} de {paginas}</span>
              <div className="flex gap-2">
                <Boton tamano="sm" icono={ChevronLeft} disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Boton>
                <Boton tamano="sm" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente<ChevronRight className="size-4" aria-hidden /></Boton>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}
