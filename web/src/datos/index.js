import { CONFIG } from '../config.js'

// Un solo interruptor (config.js → MODO) decide de dónde salen los datos.
// Las tres variantes exponen lo mismo: sesion, entrar, salir, rpc, subirExcel, confirmar, descartar, exportar, suscribir.
export async function crearDatos() {
  if (CONFIG.MODO === 'supabase') return (await import('./supabase.js')).crear(CONFIG)
  if (CONFIG.MODO === 'api') return (await import('./api.js')).crear(CONFIG)
  return (await import('./demo.js')).crear(CONFIG)
}
