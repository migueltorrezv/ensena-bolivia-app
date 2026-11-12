import { memoria } from './comun.js'
import { crearMotor } from './motor.js'

// Modo demo: sin servidor. Lee demo.json (generado desde el Excel con api/generar_demo.py)
// y responde con el mismo motor de reportes, escrito en JavaScript.
const USUARIOS = [
  { user_id: 'demo-admin', email: 'admin@demo.bo', nombre: 'Administración', rol: 'admin' },
  { user_id: 'demo-tecnico', email: 'tecnico@demo.bo', nombre: 'Técnico financiero', rol: 'tecnico' },
  { user_id: 'demo-lector', email: 'lector@demo.bo', nombre: 'Consulta', rol: 'lector' },
]

export async function crear() {
  const r = await fetch('./demo.json')
  if (!r.ok) throw new Error('No encontré demo.json junto a la página. Genéralo con api/generar_demo.py')
  const base = await r.json()
  const guardado = memoria('cp-demo')
  const sesion = memoria('cp-demo-sesion')
  let previo = {}
  try { previo = JSON.parse(guardado.leer() || '{}') } catch { previo = {} }

  const estado = {
    usuarios: previo.usuarios || USUARIOS.map((u) => ({ ...u, creado: base.generado })),
    modificaciones: previo.modificaciones || [],
    auditoria: previo.auditoria || [],
    gestiones: previo.gestiones || base.catalogos.gestiones,
    cambios: previo.cambios || 0,
    perfil: null,
  }
  const persistir = () => guardado.guardar(JSON.stringify({
    usuarios: estado.usuarios, modificaciones: estado.modificaciones, auditoria: estado.auditoria,
    gestiones: estado.gestiones, cambios: estado.cambios,
  }))
  const motor = crearMotor(base, estado)
  const perfilDe = (u) => ({ user_id: u.user_id, email: u.email, nombre: u.nombre, rol: u.rol })

  return {
    modo: 'demo',
    etiqueta: 'Demo sin servidor',
    capacidades: { crearUsuarios: false, servidorArchivos: false, tiempoReal: false },
    usuariosDemo: estado.usuarios.map(perfilDe),
    archivoDemo: base.importacion.archivo,
    async sesion() {
      const u = estado.usuarios.find((x) => x.user_id === sesion.leer())
      estado.perfil = u ? perfilDe(u) : null
      return estado.perfil
    },
    async entrar(email) {
      const u = estado.usuarios.find((x) => x.email === String(email).trim().toLowerCase())
      if (!u) throw new Error('En la demo entra con uno de los usuarios de ejemplo')
      estado.perfil = perfilDe(u)
      sesion.guardar(u.user_id)
      return estado.perfil
    },
    async salir() {
      estado.perfil = null
      sesion.guardar(null)
    },
    async rpc(fn, params) {
      const r = motor.rpc(fn, params)
      persistir()
      return r
    },
    async subirExcel() { return motor.importacionDemo() },
    async subirExcelAutomatico() {
      const imp = motor.importacionDemo()
      return { ...imp, automatico: true, resultado: imp.vista_previa }
    },
    async confirmar() { return motor.importacionDemo().vista_previa },
    async descartar() { return { ok: true } },
    async exportar() { throw new Error('En la demo las exportaciones se generan desde la web') },
    async cambiarClave() { throw new Error('En la demo no hay contraseñas') },
    suscribir() { return () => {} },
    reiniciar() {
      guardado.guardar(null)
      sesion.guardar(null)
      window.location.reload()
    },
  }
}
