import { createClient } from '@supabase/supabase-js'
import { errorDe, exportar, subirExcel, subirExcelAutomatico } from './comun.js'

const ERRORES_AUTH = {
  'Invalid login credentials': 'Correo o contraseña incorrectos',
  'Email not confirmed': 'Ese correo aún no está confirmado en Supabase',
}

export function crear(cfg) {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) {
    throw new Error('Faltan SUPABASE_URL y SUPABASE_KEY en config.js')
  }
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY)

  async function rpc(fn, params = {}) {
    const { data, error } = await sb.rpc(fn, params)
    if (error) throw new Error(error.message)
    return data
  }
  async function perfil() {
    const p = await rpc('mi_perfil')
    if (!p) throw new Error('Tu usuario no tiene perfil: vuelve a correr db/esquema.sql en Supabase')
    return p
  }
  // Importar y exportar pasan por FastAPI con el mismo token de Supabase
  async function llamar(ruta, opciones = {}) {
    if (!cfg.API_URL) throw new Error('Para importar y exportar falta API_URL (la API de FastAPI) en config.js')
    const { data } = await sb.auth.getSession()
    const r = await fetch(cfg.API_URL + ruta, {
      ...opciones,
      headers: { ...(opciones.headers || {}), Authorization: `Bearer ${data.session?.access_token || ''}` },
    })
    if (!r.ok) throw await errorDe(r)
    return r
  }

  return {
    modo: 'supabase',
    etiqueta: 'Supabase',
    capacidades: { crearUsuarios: false, servidorArchivos: Boolean(cfg.API_URL), tiempoReal: true },
    async sesion() {
      const { data } = await sb.auth.getSession()
      return data.session ? perfil() : null
    },
    async entrar(email, clave) {
      const { error } = await sb.auth.signInWithPassword({ email, password: clave })
      if (error) throw new Error(ERRORES_AUTH[error.message] || error.message)
      return perfil()
    },
    async salir() { await sb.auth.signOut() },
    rpc,
    subirExcel: (archivo, op) => subirExcel(llamar, archivo, op),
    subirExcelAutomatico: (archivo, op) => subirExcelAutomatico(llamar, archivo, op),
    confirmar: async (id) => (await llamar(`/importaciones/${id}/confirmar`, { method: 'POST' })).json(),
    descartar: async (id) => (await llamar(`/importaciones/${id}/descartar`, { method: 'POST' })).json(),
    exportar: (pedido) => exportar(llamar, pedido),
    async cambiarClave(_uid, clave) {
      const { error } = await sb.auth.updateUser({ password: clave })
      if (error) throw new Error(error.message)
    },
    suscribir(alCambiar) {
      const canal = sb.channel('cambios-presupuesto')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'importaciones' }, alCambiar)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'modificaciones' }, alCambiar)
        .subscribe()
      return () => { sb.removeChannel(canal) }
    },
  }
}
