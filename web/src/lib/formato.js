// Números al estilo boliviano: 1.234.567,89
export function num(x, dec = 2) {
  if (x === null || x === undefined || x === '' || Number.isNaN(Number(x))) return '—'
  const n = Number(x)
  const [ent, frac] = Math.abs(n).toFixed(dec).split('.')
  const conPuntos = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const signo = n < 0 && Number(Math.abs(n).toFixed(dec)) !== 0 ? '−' : ''
  return signo + conPuntos + (dec > 0 ? ',' + frac : '')
}

export const simbolo = (moneda) => (moneda === 'USD' ? 'US$' : 'Bs')

export function dinero(x, moneda = 'BS', dec = 2) {
  if (x === null || x === undefined) return '—'
  return `${simbolo(moneda)} ${num(x, dec)}`
}

// 2.634.684 → "2,63 M" · 528.694 → "528,7 mil"
export function compacto(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return '—'
  const n = Number(x)
  const a = Math.abs(n)
  if (a >= 1e6) return `${num(n / 1e6, a >= 1e7 ? 1 : 2)} M`
  if (a >= 1e4) return `${num(n / 1e3, 0)} mil`
  return num(n, 0)
}

export function pct(x, dec = 1) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return '—'
  return `${num(Number(x) * 100, dec)} %`
}

export function fecha(iso) {
  if (!iso) return '—'
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export function fechaHora(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dos = (n) => String(n).padStart(2, '0')
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`
}

export function haceCuanto(iso) {
  if (!iso) return ''
  const seg = (Date.now() - new Date(iso).getTime()) / 1000
  if (Number.isNaN(seg)) return ''
  if (seg < 60) return 'hace un momento'
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`
  if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`
  const dias = Math.round(seg / 86400)
  return dias === 1 ? 'ayer' : `hace ${dias} días`
}

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre',
  'Octubre', 'Noviembre', 'Diciembre']
export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
export const nombreMes = (m) => (m ? MESES[m - 1] : 'Presupuesto anual')

export const entero = (n) => num(n, 0)
