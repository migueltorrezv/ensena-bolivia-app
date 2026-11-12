import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useSesion } from '../componentes/Sesion.jsx'
import { Boton, Campo, Cargando, claseCampo, cx, MensajeError, Modal, Panel, Vacio } from '../componentes/Ui.jsx'
import { dinero, fecha, MESES, num } from '../lib/formato.js'
import { useConsulta } from '../lib/usar.js'

const VACIO = { financiador: '', region: '', area: '', rubro: '', cuenta: '', mes: '', tipo: 'incremento', monto: '', motivo: '', documento: '' }

function Formulario({ onListo }) {
  const { datos, catalogos, gestion, avisar, gestionCerrada } = useSesion()
  const [f, setF] = useState(VACIO)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const poner = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'rubro' ? { cuenta: '' } : {}) }))
  const cuentas = useMemo(() => catalogos.cuentas.filter((c) => !f.rubro || c.rubros.includes(f.rubro) || c.codigo.split('.')[0] === f.rubro), [catalogos, f.rubro])
  const listo = f.financiador && f.region && f.area && f.rubro && Number(f.monto) > 0 && f.motivo.trim()

  const guardar = async (e) => {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      const monto = Number(f.monto) * (f.tipo === 'reduccion' ? -1 : 1)
      await datos.rpc('registrar_modificacion', {
        p: { gestion, financiador: f.financiador, region: f.region, area: f.area, rubro: f.rubro, cuenta: f.cuenta || null,
          mes: f.mes ? Number(f.mes) : null, monto_bs: monto, motivo: f.motivo, documento: f.documento },
      })
      avisar(`Modificación registrada: ${monto > 0 ? '+' : '−'}${dinero(Math.abs(monto))}`)
      setF(VACIO)
      onListo()
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }
  const sel = (k, etiqueta, opciones, opcional) => (
    <Campo etiqueta={etiqueta}>
      <select className={claseCampo} value={f[k]} onChange={poner(k)} required={!opcional}>
        <option value="">{opcional ? 'Ninguna (a nivel de rubro)' : 'Elegir…'}</option>
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
      </select>
    </Campo>
  )
  return (
    <Panel titulo={`Registrar una modificación en ${gestion}`} descripcion="Sube o baja el presupuesto vigente de una combinación. Queda en la auditoría con tu usuario.">
      {gestionCerrada ? <p className="text-sm text-texto-2">La gestión {gestion} está cerrada: no acepta modificaciones.</p> : (
        <form onSubmit={guardar} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sel('financiador', 'Financiador', catalogos.financiadores.map((x) => ({ valor: x, etiqueta: x })))}
          {sel('region', 'Región', catalogos.regiones.map((x) => ({ valor: x.codigo, etiqueta: x.nombre })))}
          {sel('area', 'Área', catalogos.areas.map((x) => ({ valor: x, etiqueta: x })))}
          {sel('rubro', 'Rubro', catalogos.rubros.map((x) => ({ valor: x.codigo, etiqueta: x.etiqueta })))}
          {sel('cuenta', 'Cuenta', cuentas.map((x) => ({ valor: x.codigo, etiqueta: x.etiqueta })), true)}
          <Campo etiqueta="Mes">
            <select className={claseCampo} value={f.mes} onChange={poner('mes')}>
              <option value="">Anual</option>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Tipo">
            <select className={claseCampo} value={f.tipo} onChange={poner('tipo')}>
              <option value="incremento">Incremento (+)</option>
              <option value="reduccion">Reducción (−)</option>
            </select>
          </Campo>
          <Campo etiqueta="Monto en Bs">
            <input type="number" min="0.01" step="0.01" required className={cx(claseCampo, 'num')} value={f.monto} onChange={poner('monto')} placeholder="0,00" />
          </Campo>
          <Campo etiqueta="Motivo" className="sm:col-span-2">
            <input required className={claseCampo} value={f.motivo} onChange={poner('motivo')} placeholder="Ej.: reformulación aprobada por el financiador" />
          </Campo>
          <Campo etiqueta="Documento de respaldo" ayuda="Opcional: número de nota, acta o resolución" className="sm:col-span-2">
            <input className={claseCampo} value={f.documento} onChange={poner('documento')} />
          </Campo>
          <div className="flex items-center gap-3 sm:col-span-2 xl:col-span-4">
            <Boton type="submit" variante="primario" icono={Plus} disabled={!listo} cargando={enviando}>Registrar modificación</Boton>
            {error && <p className="text-sm text-critico" role="alert">{error}</p>}
          </div>
        </form>
      )}
    </Panel>
  )
}

export default function Modificaciones() {
  const { datos, gestion, puede, version, refrescar, avisar } = useSesion()
  const { datos: lista, error } = useConsulta(() => datos.rpc('listar_modificaciones', { p_filtros: gestion ? { gestiones: [gestion] } : {} }), [datos, gestion, version])
  const [borrar, setBorrar] = useState(null)
  const [borrando, setBorrando] = useState(false)
  const neto = (lista || []).reduce((s, m) => s + Number(m.monto_bs), 0)

  const confirmarBorrado = async () => {
    setBorrando(true)
    try {
      await datos.rpc('eliminar_modificacion', { p_id: borrar.id })
      avisar('Modificación eliminada')
      setBorrar(null)
      refrescar()
    } catch (e) {
      avisar(e.message, 'error')
    } finally {
      setBorrando(false)
    }
  }

  return (
    <div className="space-y-5">
      {puede.modificar && gestion && <Formulario onListo={refrescar} />}
      <Panel titulo="Modificaciones registradas" descripcion={lista?.length ? `Efecto neto sobre el presupuesto: ${neto >= 0 ? '+' : '−'}${dinero(Math.abs(neto))}` : undefined} cuerpo="p-0">
        {error && <div className="p-5"><MensajeError error={error} /></div>}
        {!lista ? <div className="p-5"><Cargando /></div> : !lista.length ? (
          <div className="p-5"><Vacio titulo={`Sin modificaciones en ${gestion}`} texto="El presupuesto vigente es igual al importado. Las modificaciones aparecen en los reportes como una columna aparte." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13.5px]">
              <thead className="bg-[#f6f8fa] text-left text-[12.5px] text-texto-2">
                <tr><th scope="col" className="px-5 py-2 font-medium">Fecha</th><th scope="col" className="px-3 py-2 font-medium">Dónde</th><th scope="col" className="px-3 py-2 text-right font-medium">Monto Bs</th>
                  <th scope="col" className="px-3 py-2 font-medium">Motivo</th><th scope="col" className="px-3 py-2 font-medium">Registró</th>{puede.modificar && <th scope="col" className="px-5 py-2"><span className="sr-only">Acciones</span></th>}</tr>
              </thead>
              <tbody>
                {lista.map((m) => (
                  <tr key={m.id} className="border-t border-borde/70 align-top">
                    <td className="num px-5 py-2.5 whitespace-nowrap text-texto-2">{fecha(m.fecha)}</td>
                    <td className="px-3 py-2.5">{m.cuenta_etiqueta || m.rubro_etiqueta}<span className="block text-[12px] text-texto-3">{m.financiador}, {m.region}, {m.area}{m.mes ? `, ${MESES[m.mes - 1]}` : ''}</span></td>
                    <td className="num px-3 py-2.5 text-right font-medium whitespace-nowrap">{Number(m.monto_bs) > 0 ? '+' : '−'}{num(Math.abs(m.monto_bs))}</td>
                    <td className="px-3 py-2.5">{m.motivo}{m.documento && <span className="block text-[12px] text-texto-3">{m.documento}</span>}</td>
                    <td className="px-3 py-2.5 text-texto-2">{m.usuario || '—'}</td>
                    {puede.modificar && (
                      <td className="px-5 py-2.5 text-right">
                        <button type="button" onClick={() => setBorrar(m)} className="rounded p-1 text-texto-3 hover:bg-fondo hover:text-critico" aria-label={`Eliminar la modificación ${m.motivo}`}>
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Modal abierto={Boolean(borrar)} titulo="Eliminar modificación" onCerrar={() => setBorrar(null)}
        pie={<><Boton onClick={() => setBorrar(null)}>Cancelar</Boton><Boton variante="peligro" icono={Trash2} onClick={confirmarBorrado} cargando={borrando}>Eliminar</Boton></>}>
        {borrar && <p className="text-sm">Se quitará la modificación de {Number(borrar.monto_bs) > 0 ? '+' : '−'}{dinero(Math.abs(borrar.monto_bs))} ({borrar.motivo}). El presupuesto vigente vuelve a su valor anterior y el borrado queda en la auditoría.</p>}
      </Modal>
    </div>
  )
}
