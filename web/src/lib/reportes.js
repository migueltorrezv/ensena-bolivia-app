// Las dimensiones que acepta reporte() y cómo se convierten en filtro al hacer clic en una fila.
export const DIMENSIONES = {
  gestion: { etiqueta: 'Gestión', filtro: 'gestiones' },
  mes: { etiqueta: 'Mes', filtro: 'meses' },
  financiador: { etiqueta: 'Financiador', filtro: 'financiadores' },
  region: { etiqueta: 'Región', filtro: 'regiones' },
  area: { etiqueta: 'Área', filtro: 'areas' },
  rubro: { etiqueta: 'Rubro', filtro: 'rubros' },
  cuenta: { etiqueta: 'Cuenta', filtro: 'cuentas' },
  cuenta_contable: { etiqueta: 'Cuenta contable', filtro: 'cuentas_contables' },
}

// Los 7 informes del reto, en el orden del documento, más el comparativo y la consulta libre.
export const REPORTES = [
  { clave: 'rubro-cuenta', titulo: 'Por rubro y cuenta', largo: 'Ejecución por rubro y cuenta', dims: ['rubro', 'cuenta'], hoja: 'por cuenta' },
  { clave: 'financiador', titulo: 'Por financiador', largo: 'Ejecución por financiador', dims: ['financiador', 'rubro'], hoja: 'Financiador' },
  { clave: 'area-financiador', titulo: 'Por área y financiador', largo: 'Ejecución por área y financiador', dims: ['area', 'financiador', 'rubro'], hoja: 'Por Area y Fin' },
  { clave: 'region', titulo: 'Por región', largo: 'Ejecución por región', dims: ['region', 'area', 'financiador', 'rubro', 'cuenta'], hoja: 'Por region y Area' },
  { clave: 'mes', titulo: 'Por mes', largo: 'Ejecución por mes', dims: ['mes'], hoja: 'Por mes' },
  { clave: 'movimientos', titulo: 'Detalle de movimientos', largo: 'Detalle de movimientos', enlace: 'movimientos' },
  { clave: 'resumen', titulo: 'Resumen general', largo: 'Resumen general consolidado', hoja: 'Rubro' },
  { clave: 'comparativo', titulo: 'Comparativo por gestiones', largo: 'Comparativo por gestiones', dims: ['rubro', 'gestion'] },
  { clave: 'libre', titulo: 'Consulta dinámica', largo: 'Consulta dinámica', dims: ['financiador', 'rubro'] },
]

// Filtros que identifican una fila del árbol (sus llaves k1..kN).
export function filtrosDeFila(fila, dims) {
  const f = {}
  for (let i = 1; i <= (fila.nivel || 0); i++) {
    const dim = dims[i - 1]
    const k = fila[`k${i}`]
    if (dim === 'mes') {
      if (k === '0') f.incluir_anual = true
      else { f.meses = [Number(k)]; f.incluir_anual = false }
    } else if (dim === 'gestion') {
      f.gestiones = [Number(k)]
    } else {
      f[DIMENSIONES[dim].filtro] = [k]
    }
  }
  return f
}

export const etiquetaFila = (fila) => (fila.nivel ? fila[`d${fila.nivel}`] : fila.d1 || 'Total general')
