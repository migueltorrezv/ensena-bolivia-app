import { errorDe, exportar, memoria, subirExcel, subirExcelAutomatico } from './comun.js'

// Modo de la foto: FastAPI + SQLAlchemy + PostgreSQL. La API hace el login y todas las consultas.
export function crear(cfg) {
  const base = cfg.API_URL
  const guardado = memoria('cp-token')
  let token = guardado.leer()

  async function llamar(ruta, opciones = {}) {
    const r = await fetch(base + ruta, {
      ...opciones,
      headers: { ...(opciones.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (r.status === 401 && token) {
      token = null
      guardado.guardar(null)
      window.dispatchEvent(new Event('sesion-expirada'))
    }
    if (!r.ok) throw await errorDe(r)
    return r
  }
  const json = (cuerpo) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const rpc = async (fn, params = {}) => (await llamar(`/rpc/${fn}`, json(params))).json()

  return {
    modo: 'api',
    etiqueta: 'FastAPI + PostgreSQL',
    capacidades: { crearUsuarios: true, servidorArchivos: true, tiempoReal: false },
    async sesion() {
      if (!token) return null
      try {
        return await (await llamar('/auth/yo')).json()
      } catch {
        return null
      }
    },
    async entrar(email, clave) {
      const r = await fetch(`${base}/auth/login`, json({ email, clave }))
      if (!r.ok) throw await errorDe(r)
      const d = await r.json()
      token = d.token
      guardado.guardar(token)
      return d.perfil
    },
    async salir() {
      token = null
      guardado.guardar(null)
    },
    rpc,
    subirExcel: (archivo, op) => subirExcel(llamar, archivo, op),
    subirExcelAutomatico: (archivo, op) => subirExcelAutomatico(llamar, archivo, op),
    confirmar: async (id) => (await llamar(`/importaciones/${id}/confirmar`, { method: 'POST' })).json(),
    descartar: async (id) => (await llamar(`/importaciones/${id}/descartar`, { method: 'POST' })).json(),
    exportar: (pedido) => exportar(llamar, pedido),
    crearUsuario: async (u) => (await llamar('/auth/usuarios', json(u))).json(),
    async cambiarClave(uid, clave) {
      await llamar(`/auth/usuarios/${uid}/clave`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave }) })
    },
    // Sin tiempo real: revisa cada 20 s si alguien importó o modificó algo
    suscribir(alCambiar) {
      let ultima = null
      const revisar = async () => {
        try {
          const v = await rpc('version_datos')
          if (ultima !== null && v !== ultima) alCambiar()
          ultima = v
        } catch { /* sin conexión: se reintenta */ }
      }
      revisar()
      const id = setInterval(revisar, 20000)
      return () => clearInterval(id)
    },
  }
}
