// Piezas que comparten los modos que hablan con la API de FastAPI.
export async function errorDe(r) {
  let msg = `Error ${r.status}`
  try {
    const j = await r.json()
    msg = typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? j.detail.map((d) => d.msg).join('; ') : j.message || msg
  } catch { /* respuesta sin JSON */ }
  const e = new Error(msg)
  e.status = r.status
  return e
}

export async function subirExcel(llamar, archivo, { modo = 'sincronizar', gestion } = {}) {
  const fd = new FormData()
  fd.append('archivo', archivo)
  fd.append('modo', modo)
  if (gestion) fd.append('gestion', String(gestion))
  return (await llamar('/importaciones', { method: 'POST', body: fd })).json()
}

export async function subirExcelAutomatico(llamar, archivo, { modo = 'sincronizar', gestion, forzarConErrores = false } = {}) {
  const fd = new FormData()
  fd.append('archivo', archivo)
  fd.append('modo', modo)
  fd.append('forzar_con_errores', String(Boolean(forzarConErrores)))
  if (gestion) fd.append('gestion', String(gestion))
  return (await llamar('/importaciones/automatico', { method: 'POST', body: fd })).json()
}

export async function exportar(llamar, pedido) {
  const r = await llamar('/exportar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedido),
  })
  const cd = r.headers.get('Content-Disposition') || ''
  const nombre = (cd.match(/filename="?([^";]+)"?/) || [])[1] || `reporte.${pedido.formato}`
  return { blob: await r.blob(), nombre }
}

export function memoria(clave) {
  return {
    leer() { try { return window.localStorage.getItem(clave) } catch { return null } },
    guardar(v) {
      try { if (v === null || v === undefined) window.localStorage.removeItem(clave); else window.localStorage.setItem(clave, v) } catch { /* sin almacenamiento */ }
    },
  }
}
