import { useRef, useState } from 'react'
import { ChevronDown, FileSpreadsheet, FileUp } from 'lucide-react'
import { useSesion } from '../componentes/Sesion.jsx'
import { Boton, Cargando, cx, EtiquetaEstado, IconoEstado, Insignia, MensajeError, Modal, Panel, Vacio } from '../componentes/Ui.jsx'
import { dinero, entero, fechaHora, num, pct } from '../lib/formato.js'
import { ir } from '../lib/ruta.js'
import { useConsulta } from '../lib/usar.js'

const SEVERIDAD = { error: 'Errores', advertencia: 'Advertencias', info: 'Información' }

// Muestra lo que trae "datos" de una validación sin volcar JSON crudo
function DetalleDatos({ datos }) {
  if (!datos) return null
  const lista = datos.combinaciones || datos.casos
  if (Array.isArray(lista) && lista.length) {
    const cols = Object.keys(lista[0])
    return (
      <div className="mt-2 max-h-56 overflow-auto rounded-md border border-borde">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-[#f6f8fa] text-texto-2"><tr>{cols.map((c) => <th key={c} scope="col" className="px-2.5 py-1.5 text-left font-medium capitalize">{c.replace('_', ' ')}</th>)}</tr></thead>
          <tbody>{lista.map((x, i) => (
            <tr key={i} className="border-t border-borde/70">{cols.map((c) => (
              <td key={c} className={cx('px-2.5 py-1.5', typeof x[c] === 'number' && 'num text-right')}>
                {Array.isArray(x[c]) ? x[c].join(', ') : typeof x[c] === 'number' ? num(x[c], Number.isInteger(x[c]) ? 0 : 2) : String(x[c] ?? '—')}
              </td>))}
            </tr>))}
          </tbody>
        </table>
      </div>
    )
  }
  if (Array.isArray(datos.filas)) {
    return <p className="mt-2 text-[12.5px] text-texto-2">Filas del Excel: <span className="num">{datos.filas.slice(0, 40).join(', ')}{datos.filas.length > 40 ? '…' : ''}</span></p>
  }
  const pares = Object.entries(datos).filter(([, v]) => typeof v !== 'object' || v === null)
  const objetos = Object.entries(datos).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
  return (
    <div className="mt-2 space-y-2 text-[12.5px] text-texto-2">
      {pares.length > 0 && <p>{pares.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? (Math.abs(v) < 1.5 && !Number.isInteger(v) ? pct(v) : num(v)) : v}`).join(' · ')}</p>}
      {objetos.map(([k, v]) => (
        <div key={k}>
          <p className="font-medium text-texto">{k.replace(/_/g, ' ')}</p>
          <p className="num">{Object.entries(v).map(([a, b]) => `${a}: ${typeof b === 'number' && b < 1.5 ? pct(b) : b}`).join(' · ')}</p>
        </div>
      ))}
    </div>
  )
}

export function ListaValidaciones({ validaciones }) {
  const [abiertas, setAbiertas] = useState({})
  if (!validaciones?.length) return <p className="text-sm text-texto-2">El archivo no tiene observaciones.</p>
  return (
    <div className="space-y-5">
      {['error', 'advertencia', 'info'].map((sev) => {
        const items = validaciones.filter((v) => v.severidad === sev)
        if (!items.length) return null
        return (
          <section key={sev}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{SEVERIDAD[sev]} <Insignia>{items.length}</Insignia></h3>
            <ul className="divide-y divide-borde rounded-lg border border-borde">
              {items.map((v, i) => {
                const k = `${sev}-${i}`
                const tieneDatos = v.datos && Object.keys(v.datos).length > 0
                return (
                  <li key={k} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <IconoEstado tipo={sev} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-texto">{v.titulo}</p>
                        {v.detalle && <p className="mt-0.5 text-[13.5px] text-texto-2">{v.detalle}</p>}
                        {tieneDatos && (
                          <button type="button" className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-serie-1 hover:underline"
                            onClick={() => setAbiertas((a) => ({ ...a, [k]: !a[k] }))} aria-expanded={Boolean(abiertas[k])}>
                            {abiertas[k] ? 'Ocultar detalle' : 'Ver detalle'}<ChevronDown className={cx('size-3.5 transition-transform', abiertas[k] && 'rotate-180')} aria-hidden />
                          </button>
                        )}
                        {abiertas[k] && <DetalleDatos datos={v.datos} />}
                      </div>
                      {(v.filas != null || v.monto_bs != null) && (
                        <div className="shrink-0 text-right text-[12.5px] text-texto-2">
                          {v.filas != null && <p className="num">{entero(v.filas)} filas</p>}
                          {v.monto_bs != null && <p className="num">{dinero(v.monto_bs)}</p>}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Diferencias({ previa }) {
  const filas = [['presupuesto', 'Filas de presupuesto'], ['movimiento', 'Movimientos']]
  return (
    <div className="overflow-x-auto rounded-lg border border-borde">
      <table className="w-full min-w-[560px] text-[13.5px]">
        <thead className="bg-[#f6f8fa] text-[12.5px] text-texto-2">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">Qué cambia</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">En el archivo</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Nuevas</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Sin cambio</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Se eliminan</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(([k, t]) => {
            const x = previa[k] || {}
            return (
              <tr key={k} className="border-t border-borde/70">
                <th scope="row" className="px-4 py-2.5 text-left font-medium">{t}</th>
                <td className="num px-3 py-2.5 text-right">{entero(x.en_archivo || 0)}</td>
                <td className="num px-3 py-2.5 text-right">{entero(x.nuevos || 0)}<span className="block text-[12px] text-texto-3">{dinero(x.nuevos_bs || 0)}</span></td>
                <td className="num px-3 py-2.5 text-right">{entero(x.sin_cambio || 0)}</td>
                <td className={cx('num px-4 py-2.5 text-right', x.a_eliminar > 0 && 'font-semibold text-[#9e2020]')}>
                  {entero(x.a_eliminar || 0)}<span className="block text-[12px] font-normal text-texto-3">{dinero(x.a_eliminar_bs || 0)}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Analisis({ imp, onAplicar, onDescartar, aplicando }) {
  const r = imp.resumen
  const eliminar = (imp.vista_previa?.movimiento?.a_eliminar || 0) + (imp.vista_previa?.presupuesto?.a_eliminar || 0)
  return (
    <Panel titulo={`Análisis de ${imp.archivo || 'el archivo'}`}
      descripcion={`Gestión ${imp.gestion} · hoja «${r.hoja}» · ${entero(r.filas_leidas)} filas leídas${r.filas_omitidas ? `, ${entero(r.filas_omitidas)} omitidas` : ''}`}>
      <div className="space-y-6">
        {imp.demo && (
          <p className="rounded-lg bg-serie-1-pista px-4 py-3 text-sm text-tinta">
            En la demo no se procesa tu archivo: este es el análisis real que hizo el servidor con {imp.archivo}. Con el modo Supabase o FastAPI se analiza el archivo que subas.
          </p>
        )}
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[13px] text-texto-2">Presupuesto</dt><dd className="text-[17px] font-semibold">{dinero(r.presupuesto.monto_bs)}</dd><dd className="text-[12.5px] text-texto-3">{entero(r.presupuesto.filas)} filas</dd></div>
          <div><dt className="text-[13px] text-texto-2">Ejecutado</dt><dd className="text-[17px] font-semibold">{dinero(r.movimientos.ejecutado_bs)}</dd><dd className="text-[12.5px] text-texto-3">{entero(r.movimientos.filas)} movimientos</dd></div>
          <div><dt className="text-[13px] text-texto-2">Ejecución real</dt><dd className="text-[17px] font-semibold">{pct(r.pct_ejecucion)}</dd><dd className="text-[12.5px] text-texto-3">Solo filas de presupuesto</dd></div>
          <div><dt className="text-[13px] text-texto-2">Según las dinámicas del Excel</dt><dd className="text-[17px] font-semibold">{pct(r.pct_excel)}</dd><dd className="text-[12.5px] text-texto-3">Presupuesto {dinero(r.presupuesto_excel_bs)}</dd></div>
        </dl>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Qué va a cambiar en la base</h3>
          <Diferencias previa={imp.vista_previa || {}} />
          {eliminar > 0 && <p className="mt-2 flex items-center gap-2 text-[13px] text-texto-2"><IconoEstado tipo="advertencia" />Las filas que se eliminan ya no vienen en el archivo (modo sincronizar).</p>}
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold">Lo que encontramos en el archivo</h3>
          <ListaValidaciones validaciones={imp.validaciones} />
        </div>
        <div className="flex flex-wrap gap-2 border-t border-borde pt-4">
          <Boton variante="primario" onClick={onAplicar} cargando={aplicando}>Aplicar importación</Boton>
          <Boton onClick={onDescartar} disabled={aplicando}>Descartar</Boton>
        </div>
      </div>
    </Panel>
  )
}

function Historial() {
  const { datos, version } = useSesion()
  const { datos: lista, error } = useConsulta(() => datos.rpc('listar_importaciones', { p_limite: 30 }), [datos, version])
  const [ver, setVer] = useState(null)
  const { datos: vals } = useConsulta(() => (ver ? datos.rpc('validaciones_de', { p_importacion: ver.id }) : null), [datos, ver?.id])
  const tono = { aplicada: 'bien', borrador: 'aviso', descartada: 'neutro' }
  return (
    <Panel titulo="Historial de importaciones" cuerpo="p-0">
      {error && <div className="p-5"><MensajeError error={error} /></div>}
      {!lista ? <div className="p-5"><Cargando /></div> : !lista.length ? <p className="px-5 py-4 text-sm text-texto-2">Todavía no se importó ningún archivo.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead className="bg-[#f6f8fa] text-left text-[12.5px] text-texto-2">
              <tr><th scope="col" className="px-5 py-2 font-medium">Fecha</th><th scope="col" className="px-3 py-2 font-medium">Archivo</th><th scope="col" className="px-3 py-2 font-medium">Gestión</th>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th><th scope="col" className="px-3 py-2 font-medium">Cambios</th><th scope="col" className="px-3 py-2 font-medium">Usuario</th><th scope="col" className="px-5 py-2"><span className="sr-only">Validaciones</span></th></tr>
            </thead>
            <tbody>
              {lista.map((i) => {
                const m = i.resultado?.movimiento
                return (
                  <tr key={i.id} className="border-t border-borde/70">
                    <td className="num px-5 py-2.5 whitespace-nowrap text-texto-2">{fechaHora(i.aplicado || i.creado)}</td>
                    <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><FileSpreadsheet className="size-4 text-texto-3" aria-hidden />{i.archivo}</span></td>
                    <td className="num px-3 py-2.5">{i.gestion}</td>
                    <td className="px-3 py-2.5"><Insignia tono={tono[i.estado]}>{i.estado}</Insignia></td>
                    <td className="px-3 py-2.5 text-texto-2">{m ? `+${entero(m.nuevos)} / −${entero(m.a_eliminar)} movimientos` : '—'}</td>
                    <td className="px-3 py-2.5 text-texto-2">{i.usuario || '—'}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button type="button" className="text-[13px] font-medium text-serie-1 hover:underline" onClick={() => setVer(i)}>
                        {Object.entries(i.validaciones || {}).map(([k, n]) => `${n} ${k === 'advertencia' ? 'avisos' : k === 'error' ? 'errores' : 'info'}`).join(', ') || 'Ver'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal abierto={Boolean(ver)} titulo={ver ? `Validaciones de ${ver.archivo}` : ''} onCerrar={() => setVer(null)} ancho="max-w-3xl">
        {!vals ? <Cargando /> : <ListaValidaciones validaciones={vals} />}
      </Modal>
    </Panel>
  )
}

export default function Importar() {
  const { datos, puede, catalogos, gestion, refrescar, avisar, gestionCerrada } = useSesion()
  const [archivo, setArchivo] = useState(null)
  const [modo, setModo] = useState('sincronizar')
  const [gestionArchivo, setGestionArchivo] = useState('')
  const [imp, setImp] = useState(null)
  const [error, setError] = useState(null)
  const [estado, setEstado] = useState(null)
  const [arrastrando, setArrastrando] = useState(false)
  const input = useRef(null)
  const demo = datos.modo === 'demo'
  const sinServidor = datos.modo === 'supabase' && !datos.capacidades.servidorArchivos

  const analizar = async () => {
    setEstado('analizando')
    setError(null)
    try {
      setImp(await datos.subirExcel(archivo, { modo, gestion: gestionArchivo || undefined }))
    } catch (e) {
      setError(e.message)
    } finally {
      setEstado(null)
    }
  }
  const aplicar = async () => {
    setEstado('aplicando')
    try {
      const r = await datos.confirmar(imp.importacion_id)
      const m = r?.movimiento || {}
      avisar(imp.demo ? 'En la demo los datos ya están cargados' : `Importación aplicada: ${entero(m.nuevos || 0)} movimientos nuevos, ${entero(m.a_eliminar || 0)} eliminados`)
      setImp(null)
      setArchivo(null)
      refrescar()
      if (!imp.demo) ir('tablero')
    } catch (e) {
      setError(e.message)
    } finally {
      setEstado(null)
    }
  }
  const descartar = async () => {
    try { await datos.descartar(imp.importacion_id) } catch { /* ya no existe */ }
    setImp(null)
    avisar('Importación descartada: no cambió nada')
    refrescar()
  }
  const elegir = (f) => {
    if (!f) return
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) { setError('Elige un archivo de Excel (.xlsx)'); return }
    setError(null)
    setArchivo(f)
  }

  return (
    <div className="space-y-5">
      {!puede.importar ? (
        <Vacio titulo="Tu usuario solo puede consultar" texto="Para importar el Excel del sistema contable pide el rol técnico o admin." />
      ) : imp ? (
        <Analisis imp={imp} onAplicar={aplicar} onDescartar={descartar} aplicando={estado === 'aplicando'} />
      ) : (
        <Panel titulo="Subir el Excel del sistema contable"
          descripcion="Se lee la hoja BD, se revisa y se te muestra qué cambiaría. Nada se guarda hasta que apliques la importación.">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div>
              {demo ? (
                <div className="flex h-full flex-col items-start justify-center gap-3 rounded-xl border-2 border-dashed border-borde-fuerte bg-fondo/60 p-6">
                  <FileSpreadsheet className="size-8 text-texto-3" aria-hidden />
                  <p className="font-medium">En la demo se usa el archivo de prueba</p>
                  <p className="text-sm text-texto-2">{datos.archivoDemo}: el mismo Excel del reto, ya analizado por el servidor.</p>
                  <Boton variante="primario" icono={FileUp} onClick={analizar} cargando={estado === 'analizando'}>Ver el análisis</Boton>
                </div>
              ) : (
                <div onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }} onDragLeave={() => setArrastrando(false)}
                  onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files?.[0]) }}
                  className={cx('flex flex-col items-start gap-3 rounded-xl border-2 border-dashed p-6 transition-colors',
                    arrastrando ? 'border-serie-1 bg-serie-1-pista/70' : 'border-borde-fuerte bg-fondo/60')}>
                  <FileUp className="size-8 text-texto-3" aria-hidden />
                  {archivo ? (
                    <p className="text-sm"><span className="font-medium">{archivo.name}</span> <span className="text-texto-3">({num(archivo.size / 1024, 0)} KB)</span></p>
                  ) : <p className="text-sm text-texto-2">Arrastra aquí el archivo .xlsx o elígelo desde tu computadora.</p>}
                  <div className="flex flex-wrap gap-2">
                    <Boton onClick={() => input.current?.click()}>{archivo ? 'Elegir otro' : 'Elegir archivo'}</Boton>
                    <Boton variante="primario" icono={FileUp} disabled={!archivo || sinServidor} onClick={analizar} cargando={estado === 'analizando'}>Analizar archivo</Boton>
                  </div>
                  <input ref={input} type="file" accept=".xlsx,.xlsm" className="sr-only" onChange={(e) => elegir(e.target.files?.[0])} aria-label="Archivo de Excel" />
                  {sinServidor && <p className="text-[13px] text-[#7a5200]">Para importar falta API_URL en config.js: la lectura del Excel la hace FastAPI.</p>}
                </div>
              )}
            </div>
            <fieldset className="space-y-4" disabled={demo}>
              <legend className="sr-only">Opciones</legend>
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-texto-2">Cómo aplicar el archivo</p>
                {[['sincronizar', 'El archivo trae toda la gestión hasta hoy', 'Lo que el sistema contable corrigió o borró se refleja. Es lo normal con el export diario.'],
                  ['agregar', 'Solo agregar filas nuevas', 'Para archivos parciales: no elimina nada de lo que ya está.']].map(([v, t, d]) => (
                  <label key={v} className={cx('flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5', modo === v ? 'border-serie-1 bg-serie-1-pista/50' : 'border-borde')}>
                    <input type="radio" name="modo" value={v} checked={modo === v} onChange={() => setModo(v)} className="mt-1 accent-tinta" />
                    <span><span className="block text-sm font-medium">{t}</span><span className="block text-[12.5px] text-texto-2">{d}</span></span>
                  </label>
                ))}
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-texto-2">Gestión</span>
                <select value={gestionArchivo} onChange={(e) => setGestionArchivo(e.target.value)} className="h-9 rounded-lg border border-borde-fuerte bg-superficie px-3 text-sm">
                  <option value="">Detectarla con las fechas del archivo</option>
                  {[...new Set([...(catalogos.gestiones || []).map((g) => g.anio), new Date().getFullYear(), new Date().getFullYear() - 1, gestion].filter(Boolean))]
                    .sort((a, b) => b - a).map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              {gestionCerrada && <p className="flex items-center gap-2 text-[13px] text-texto-2"><EtiquetaEstado tipo="aviso">Cerrada</EtiquetaEstado>La gestión {gestion} no acepta importaciones.</p>}
            </fieldset>
          </div>
          {error && <div className="mt-4"><MensajeError error={error} /></div>}
        </Panel>
      )}
      {imp && error && <MensajeError error={error} />}
      <Historial />
    </div>
  )
}
