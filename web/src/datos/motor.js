// Réplica en el navegador de las funciones SQL de db/esquema.sql, para el modo demo.
// Mismos nombres, mismos parámetros y mismas columnas: la web no distingue si los
// datos vienen de Postgres o de aquí. Los montos se suman en centavos (enteros) para
// que los totales cuadren al centavo, igual que el tipo numeric de Postgres.

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre',
  'Octubre', 'Noviembre', 'Diciembre']
const nombreMes = (m) => (m ? MESES[m - 1] : 'Presupuesto anual')
const DIMS = ['gestion', 'mes', 'financiador', 'region', 'area', 'rubro', 'cuenta', 'cuenta_contable']

const redondear = (x, dec) => {
  const f = 10 ** dec
  return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f
}
const centavos = (x) => Math.round(Number(x || 0) * 100)

// Orden como Postgres: arreglos elemento a elemento, nulos al final
function comparar(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
    return a.length - b.length
  }
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  return a < b ? -1 : 1
}

class ErrorDemo extends Error {}

export function crearMotor(base, estado) {
  const cat = base.catalogos
  const rubros = new Map(cat.rubros.map((r) => [r.codigo, r]))
  const cuentas = new Map(cat.cuentas.map((c) => [c.codigo, c]))
  const regiones = new Map(cat.regiones.map((r) => [r.codigo, r.nombre]))

  const presupuestos = base.presupuestos.map(([gestion, mes, financiador, region, area, rubro, cuenta, monto]) => ({
    gestion, mes, financiador, region, area, rubro, cuenta, bs: centavos(monto),
  }))
  const movimientos = base.movimientos.map(([id, gestion, mes, fecha, tipo, numero, no_cheque, financiador, region, area,
    rubro, cuenta, cuenta_contable, nombre_contable, ref, debe, haber, dusd, husd, tasa]) => ({
    id, gestion, mes, fecha, tipo, numero, no_cheque, financiador, region, area, rubro, cuenta, cuenta_contable,
    nombre_contable, ref, debe_bs: debe || 0, haber_bs: haber || 0, tasa,
    bs: centavos(debe) - centavos(haber), usd: centavos(dusd) - centavos(husd),
  }))

  const rol = () => estado.perfil?.rol || 'anonimo'
  const esEditor = () => ['admin', 'tecnico'].includes(rol())
  const esAdmin = () => rol() === 'admin'
  const tasaDe = (g) => Number(estado.gestiones.find((x) => x.anio === g)?.tasa_presupuesto || 6.96)
  const auditar = (tabla, operacion, registro, antes, despues) => {
    estado.auditoria.unshift({ id: (estado.auditoria[0]?.id || 0) + 1, fecha: new Date().toISOString(),
      usuario: estado.perfil?.user_id, email: estado.perfil?.email, tabla, operacion, registro: String(registro), antes, despues })
    estado.cambios += 1
  }

  // --- leer_filtros ---------------------------------------------------------
  function lista(p, k) {
    const v = p?.[k]
    if (Array.isArray(v)) return v.length ? v.map(String) : null
    if (typeof v === 'string' || typeof v === 'number') return [String(v)]
    return null
  }
  function leerFiltros(p = {}) {
    p = p || {}
    return {
      gestiones: lista(p, 'gestiones')?.map(Number) ?? [Math.max(...estado.gestiones.map((g) => g.anio))],
      financiadores: lista(p, 'financiadores'), regiones: lista(p, 'regiones'), areas: lista(p, 'areas'),
      rubros: lista(p, 'rubros'), cuentas: lista(p, 'cuentas'), cc: lista(p, 'cuentas_contables'),
      meses: lista(p, 'meses')?.map(Number) ?? null,
      desde: p.mes_desde != null && p.mes_desde !== '' ? Number(p.mes_desde) : 1,
      hasta: p.mes_hasta != null && p.mes_hasta !== '' ? Number(p.mes_hasta) : 12,
      anual: !(p.incluir_anual === false || p.incluir_anual === 'false'),
      texto: String(p.texto || '').trim() || null,
    }
  }
  const pasaDims = (f, r) => f.gestiones.includes(r.gestion)
    && (!f.financiadores || f.financiadores.includes(r.financiador))
    && (!f.regiones || f.regiones.includes(r.region))
    && (!f.areas || f.areas.includes(r.area))
    && (!f.rubros || f.rubros.includes(r.rubro))
    && (!f.cuentas || f.cuentas.includes(r.cuenta ?? ''))
    && (!f.cc || (r.cuenta_contable != null && f.cc.includes(r.cuenta_contable)))
  const pasaMes = (f, mes) => (mes == null ? f.anual : (!f.meses || f.meses.includes(mes)) && mes >= f.desde && mes <= f.hasta)

  // --- datos_reporte ---------------------------------------------------------
  function datosReporte(filtros, moneda = 'BS') {
    const f = leerFiltros(filtros)
    const usd = String(moneda).toUpperCase() === 'USD'
    const aMoneda = (bs, g) => (usd ? Math.sign(bs) * Math.round(Math.abs(bs) / tasaDe(g)) : bs)
    const filas = []
    for (const p of presupuestos) {
      if (pasaDims(f, { ...p, cuenta_contable: null }) && pasaMes(f, p.mes)) {
        filas.push({ origen: 'presupuesto', ...p, cuenta_contable: null, nombre_contable: null, pre: aMoneda(p.bs, p.gestion), mod: 0, eje: 0, movs: 0 })
      }
    }
    for (const m of estado.modificaciones) {
      const r = { ...m, cuenta_contable: null }
      if (pasaDims(f, r) && pasaMes(f, m.mes)) {
        filas.push({ origen: 'modificacion', ...r, nombre_contable: null, pre: 0, mod: aMoneda(centavos(m.monto_bs), m.gestion), eje: 0, movs: 0 })
      }
    }
    for (const m of movimientos) {
      if (pasaDims(f, m) && pasaMes(f, m.mes)) {
        filas.push({ origen: 'movimiento', ...m, pre: 0, mod: 0, eje: usd ? m.usd : m.bs, movs: 1 })
      }
    }
    return filas
  }

  const ESPEC = {
    gestion: (r) => [String(r.gestion), String(r.gestion), r.gestion],
    mes: (r) => [String(r.mes ?? 0), nombreMes(r.mes), r.mes ?? 13],
    financiador: (r) => [r.financiador, r.financiador, r.financiador],
    region: (r) => [r.region, regiones.get(r.region) ?? r.region, r.region],
    area: (r) => [r.area, r.area, r.area],
    rubro: (r) => [r.rubro, rubros.get(r.rubro)?.etiqueta ?? r.rubro, rubros.get(r.rubro)?.orden ?? []],
    cuenta: (r) => [r.cuenta ?? '', (r.cuenta && cuentas.get(r.cuenta)?.etiqueta) || '(sin cuenta)', (r.cuenta && cuentas.get(r.cuenta)?.orden) || []],
    cuenta_contable: (r) => [r.cuenta_contable ?? '', r.cuenta_contable != null ? `${r.cuenta_contable} ${r.nombre_contable ?? ''}` : '(presupuesto)', r.cuenta_contable ?? ''],
  }

  function medidas(filas) {
    let pre = 0; let mod = 0; let eje = 0; let movs = 0
    for (const r of filas) { pre += r.pre; mod += r.mod; eje += r.eje; movs += r.movs }
    if (!filas.length) {
      return { presupuesto: null, modificaciones: null, presupuesto_vigente: null, ejecutado: null, saldo: null,
        pct_ejecucion: null, presupuesto_excel: null, pct_excel: null, movimientos: null }
    }
    const vig = pre + mod
    return {
      presupuesto: pre / 100, modificaciones: mod / 100, presupuesto_vigente: vig / 100, ejecutado: eje / 100,
      saldo: (vig - eje) / 100, pct_ejecucion: vig ? redondear(eje / vig, 4) : null,
      presupuesto_excel: (pre + eje) / 100, pct_excel: pre + eje ? redondear(eje / (pre + eje), 4) : null, movimientos: movs,
    }
  }

  // --- reporte (GROUP BY ROLLUP) ----------------------------------------------
  function reporte(dims = [], filtros = {}, moneda = 'BS') {
    dims = dims || []
    if (dims.length > 6) throw new ErrorDemo(`Máximo 6 dimensiones (llegaron ${dims.length})`)
    if (new Set(dims).size !== dims.length) throw new ErrorDemo('Hay dimensiones repetidas')
    for (const d of dims) if (!DIMS.includes(d)) throw new ErrorDemo(`Dimensión no permitida: ${d}`)
    if (!['BS', 'USD'].includes(String(moneda || 'BS').toUpperCase())) throw new ErrorDemo(`Moneda inválida: ${moneda}`)
    const filas = datosReporte(filtros, moneda)
    const n = dims.length
    const salida = []
    const vacia = () => Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap((i) => [[`k${i}`, null], [`d${i}`, null]]))

    function bajar(grupo, i, llaves, etiquetas) {
      const porLlave = new Map()
      for (const r of grupo) {
        const [k, d, o] = ESPEC[dims[i]](r)
        if (!porLlave.has(k)) porLlave.set(k, { k, d, o, filas: [] })
        porLlave.get(k).filas.push(r)
      }
      const orden = [...porLlave.values()].sort((a, b) => comparar(a.o, b.o) || comparar(a.k, b.k))
      for (const g of orden) {
        const ks = [...llaves, g.k]
        const ds = [...etiquetas, g.d]
        const fila = { nivel: i + 1, ...vacia() }
        ks.forEach((k, j) => { fila[`k${j + 1}`] = k; fila[`d${j + 1}`] = ds[j] })
        salida.push({ ...fila, ...medidas(g.filas) })
        if (i + 1 < n) bajar(g.filas, i + 1, ks, ds)
      }
    }
    if (n) bajar(filas, 0, [], [])
    salida.push({ nivel: 0, ...vacia(), d1: 'Total general', ...medidas(filas) })
    return salida
  }

  // --- detalle_movimientos -------------------------------------------------------
  function detalle(filtros = {}, limite = 100, desplazamiento = 0) {
    const f = leerFiltros(filtros)
    const t = f.texto?.toLowerCase()
    const filas = movimientos.filter((m) => pasaDims(f, m)
      && (!f.meses || f.meses.includes(m.mes)) && m.mes >= f.desde && m.mes <= f.hasta
      && (!t || (m.ref || '').toLowerCase().includes(t) || (m.nombre_contable || '').toLowerCase().includes(t) || String(m.numero) === f.texto))
    filas.sort((a, b) => (a.fecha === b.fecha ? b.id - a.id : !a.fecha ? 1 : !b.fecha ? -1 : a.fecha < b.fecha ? 1 : -1))
    const lim = Math.min(Math.max(Number(limite) || 100, 1), 50000)
    const desde = Math.max(Number(desplazamiento) || 0, 0)
    return filas.slice(desde, desde + lim).map((m) => ({
      id: m.id, gestion: m.gestion, mes: m.mes, fecha: m.fecha, tipo: m.tipo, numero: m.numero, no_cheque: m.no_cheque,
      financiador: m.financiador, region: m.region, area: m.area, rubro: m.rubro,
      rubro_etiqueta: rubros.get(m.rubro)?.etiqueta ?? m.rubro, cuenta: m.cuenta,
      cuenta_etiqueta: (m.cuenta && cuentas.get(m.cuenta)?.etiqueta) || '(sin cuenta)',
      cuenta_contable: m.cuenta_contable, nombre_contable: m.nombre_contable, ref: m.ref,
      debe_bs: m.debe_bs, haber_bs: m.haber_bs, ejecutado_bs: m.bs / 100, ejecutado_usd: m.usd / 100, tasa: m.tasa,
      total: filas.length,
    }))
  }

  function alertas(filtros = {}, umbral = 0.8) {
    const u = umbral == null ? 0.8 : Number(umbral)
    return reporte(['financiador', 'rubro', 'cuenta'], filtros, 'BS')
      .filter((r) => r.nivel === 3 && r.ejecutado > 0 && (r.presupuesto_vigente <= 0 || r.ejecutado >= u * r.presupuesto_vigente))
      .sort((a, b) => (a.pct_ejecucion === b.pct_ejecucion
        ? comparar(a.k1, b.k1) || comparar(a.k2, b.k2) || comparar(a.k3, b.k3)
        : a.pct_ejecucion == null ? -1 : b.pct_ejecucion == null ? 1 : b.pct_ejecucion - a.pct_ejecucion))
      .map((r) => ({
        financiador: r.k1, rubro: r.k2, rubro_etiqueta: r.d2, cuenta: r.k3, cuenta_etiqueta: r.d3,
        presupuesto_vigente: r.presupuesto_vigente, ejecutado: r.ejecutado, pct_ejecucion: r.pct_ejecucion,
        alerta: r.presupuesto_vigente <= 0 ? 'gasto sin presupuesto' : r.ejecutado > r.presupuesto_vigente ? 'sobregiro' : 'cerca del límite',
      }))
  }

  function resumen(filtros = {}, moneda = 'BS') {
    const f = leerFiltros(filtros)
    const tot = reporte([], filtros, moneda)[0]
    const meses = movimientos.filter((m) => f.gestiones.includes(m.gestion) && m.mes >= f.desde && m.mes <= f.hasta).map((m) => m.mes)
    const ultimo = meses.length ? Math.max(...meses) : null
    const nivel1 = (dim) => reporte([dim], filtros, moneda).filter((r) => r.nivel === 1)
    const nulo = (xs) => (xs.length ? xs : null)
    const porFin = nivel1('financiador').sort((a, b) => b.ejecutado - a.ejecutado)
    const porMes = new Map()
    for (const r of datosReporte(filtros, moneda)) if (r.origen === 'movimiento') porMes.set(r.mes, (porMes.get(r.mes) || 0) + r.eje)
    const imp = base.importacion
    return {
      gestiones: f.gestiones, moneda: String(moneda || 'BS').toUpperCase(),
      presupuesto: tot.presupuesto, modificaciones: tot.modificaciones, presupuesto_vigente: tot.presupuesto_vigente,
      ejecutado: tot.ejecutado, saldo: tot.saldo, pct_ejecucion: tot.pct_ejecucion,
      presupuesto_excel: tot.presupuesto_excel, pct_excel: tot.pct_excel, movimientos: tot.movimientos,
      ultimo_mes: ultimo, avance_tiempo: redondear((ultimo || 0) / 12, 4),
      ritmo: redondear((tot.pct_ejecucion || 0) - (ultimo || 0) / 12, 4),
      por_financiador: nulo(porFin.map((r) => ({ clave: r.k1, etiqueta: r.d1, vigente: r.presupuesto_vigente, ejecutado: r.ejecutado, saldo: r.saldo, pct: r.pct_ejecucion }))),
      por_rubro: nulo(nivel1('rubro').map((r) => ({ clave: r.k1, etiqueta: r.d1, vigente: r.presupuesto_vigente, ejecutado: r.ejecutado, saldo: r.saldo, pct: r.pct_ejecucion }))),
      por_region: nulo(nivel1('region').map((r) => ({ clave: r.k1, etiqueta: r.d1, vigente: r.presupuesto_vigente, ejecutado: r.ejecutado, pct: r.pct_ejecucion }))),
      por_mes: nulo([...porMes.entries()].sort((a, b) => a[0] - b[0]).map(([mes, c]) => ({ mes, etiqueta: nombreMes(mes), ejecutado: c / 100 }))),
      alertas: alertas(filtros, 0.8).length,
      ultima_importacion: f.gestiones.includes(imp.gestion) ? { id: 1, archivo: imp.archivo, aplicado: base.generado } : null,
    }
  }

  function catalogos() {
    const usados = (campo) => new Set([...presupuestos, ...movimientos].map((x) => x[campo]))
    const regUsadas = usados('region')
    const rubrosDeCuenta = new Map()
    for (const x of [...presupuestos, ...movimientos]) {
      if (!x.cuenta) continue
      if (!rubrosDeCuenta.has(x.cuenta)) rubrosDeCuenta.set(x.cuenta, new Set())
      rubrosDeCuenta.get(x.cuenta).add(x.rubro)
    }
    return {
      gestiones: [...estado.gestiones].sort((a, b) => b.anio - a.anio),
      financiadores: [...cat.financiadores].sort(),
      regiones: cat.regiones.filter((r) => regUsadas.has(r.codigo)).sort((a, b) => comparar(a.codigo, b.codigo)),
      areas: [...cat.areas].sort(),
      rubros: [...cat.rubros].sort((a, b) => comparar(a.orden, b.orden) || comparar(a.codigo, b.codigo)).map(({ codigo, etiqueta }) => ({ codigo, etiqueta })),
      cuentas: [...cat.cuentas].sort((a, b) => comparar(a.orden, b.orden) || comparar(a.codigo, b.codigo))
        .map(({ codigo, etiqueta }) => ({ codigo, etiqueta, rubros: [...(rubrosDeCuenta.get(codigo) || [])].sort() })),
    }
  }

  // --- Modificaciones, usuarios, gestiones, auditoría ---------------------------------
  function listarModificaciones(filtros = {}) {
    const f = leerFiltros(filtros)
    return estado.modificaciones.filter((m) => f.gestiones.includes(m.gestion))
      .map((m) => ({ ...m, rubro_etiqueta: rubros.get(m.rubro)?.etiqueta ?? m.rubro, cuenta_etiqueta: m.cuenta ? cuentas.get(m.cuenta)?.etiqueta ?? m.cuenta : null }))
      .sort((a, b) => (a.creado < b.creado ? 1 : a.creado > b.creado ? -1 : b.id - a.id))
  }
  function registrarModificacion(p = {}) {
    if (!esEditor()) throw new ErrorDemo('Solo un admin o un técnico puede registrar modificaciones')
    const gestion = Number(p.gestion)
    if (estado.gestiones.find((g) => g.anio === gestion)?.estado === 'cerrada') throw new ErrorDemo(`La gestión ${gestion} está cerrada`)
    if (!Number(p.monto_bs)) throw new ErrorDemo('El monto no puede ser cero')
    if (!String(p.motivo || '').trim()) throw new ErrorDemo('Escribe el motivo de la modificación')
    for (const [campo, existe] of [['financiador', cat.financiadores.includes(p.financiador)], ['region', regiones.has(p.region)],
      ['area', cat.areas.includes(p.area)], ['rubro', rubros.has(p.rubro)], ['cuenta', !p.cuenta || cuentas.has(p.cuenta)]]) {
      if (!existe) throw new ErrorDemo(`Alguno de los datos no existe en los catálogos (${campo})`)
    }
    const id = Math.max(0, ...estado.modificaciones.map((m) => m.id)) + 1
    const ahora = new Date().toISOString()
    const m = { id, gestion, mes: p.mes ? Number(p.mes) : null, financiador: p.financiador, region: p.region, area: p.area,
      rubro: p.rubro, cuenta: p.cuenta || null, monto_bs: redondear(Number(p.monto_bs), 2), motivo: String(p.motivo).trim(),
      documento: String(p.documento || '').trim() || null, fecha: p.fecha || ahora.slice(0, 10), creado: ahora, usuario: estado.perfil?.email }
    estado.modificaciones.push(m)
    auditar('modificaciones', 'INSERT', id, null, m)
    return id
  }
  function eliminarModificacion(id) {
    if (!esEditor()) throw new ErrorDemo('Solo un admin o un técnico puede eliminar modificaciones')
    const i = estado.modificaciones.findIndex((m) => m.id === Number(id))
    if (i < 0) throw new ErrorDemo(`No existe la modificación ${id}`)
    const [m] = estado.modificaciones.splice(i, 1)
    auditar('modificaciones', 'DELETE', id, m, null)
  }
  function listarUsuarios() {
    if (!esAdmin()) throw new ErrorDemo('Solo un admin puede ver los usuarios')
    return estado.usuarios.map(({ user_id, email, nombre, rol: r, creado }) => ({ user_id, email, nombre, rol: r, creado }))
  }
  function cambiarRol(uid, nuevo) {
    if (!esAdmin()) throw new ErrorDemo('Solo un admin puede cambiar roles')
    if (!['admin', 'tecnico', 'lector'].includes(nuevo)) throw new ErrorDemo(`Rol inválido: ${nuevo}`)
    const u = estado.usuarios.find((x) => x.user_id === uid)
    if (!u) throw new ErrorDemo('No existe el usuario')
    if (nuevo !== 'admin' && u.rol === 'admin' && estado.usuarios.filter((x) => x.rol === 'admin').length === 1) {
      throw new ErrorDemo('No se puede quitar el rol al único admin')
    }
    const antes = { ...u }
    u.rol = nuevo
    auditar('perfiles', 'UPDATE', uid, antes, { ...u })
  }
  function listarAuditoria(limite = 100, tabla = null) {
    if (!esAdmin()) throw new ErrorDemo('Solo un admin puede ver la auditoría')
    return estado.auditoria.filter((a) => !tabla || a.tabla === tabla).slice(0, Math.min(Math.max(Number(limite) || 100, 1), 500))
  }
  function actualizarGestion(anio, nuevoEstado, tasa, nota) {
    if (!esAdmin()) throw new ErrorDemo('Solo un admin puede modificar gestiones')
    const g = estado.gestiones.find((x) => x.anio === Number(anio))
    if (!g) throw new ErrorDemo(`No existe la gestión ${anio}`)
    const antes = { ...g }
    if (nuevoEstado) g.estado = nuevoEstado
    if (tasa != null && tasa !== '') g.tasa_presupuesto = Number(tasa)
    if (nota != null) g.nota = nota
    auditar('gestiones', 'UPDATE', anio, antes, { ...g })
  }

  const imp = base.importacion
  const registroImportacion = () => ({
    id: 1, gestion: imp.gestion, archivo: imp.archivo, modo: 'sincronizar', estado: 'aplicada', creado: base.generado,
    aplicado: base.generado, resumen: imp.resumen, resultado: imp.resultado, usuario: 'tecnico@demo.bo',
    validaciones: imp.validaciones.reduce((acc, v) => ({ ...acc, [v.severidad]: (acc[v.severidad] || 0) + 1 }), {}),
  })

  const FUNCIONES = {
    mi_perfil: () => estado.perfil,
    rol_actual: () => rol(),
    catalogos,
    version_datos: () => String(estado.cambios),
    reporte_json: (p) => reporte(p.p_dimensiones, p.p_filtros, p.p_moneda),
    detalle_movimientos: (p) => detalle(p.p_filtros, p.p_limite, p.p_desplazamiento),
    resumen_general: (p) => resumen(p.p_filtros, p.p_moneda),
    alertas_ejecucion: (p) => alertas(p.p_filtros, p.p_umbral),
    listar_importaciones: () => [registroImportacion()],
    validaciones_de: () => imp.validaciones,
    listar_modificaciones: (p) => listarModificaciones(p.p_filtros),
    registrar_modificacion: (p) => registrarModificacion(p.p),
    eliminar_modificacion: (p) => eliminarModificacion(p.p_id),
    listar_usuarios: listarUsuarios,
    cambiar_rol: (p) => cambiarRol(p.p_user_id, p.p_rol),
    listar_auditoria: (p) => listarAuditoria(p.p_limite, p.p_tabla),
    actualizar_gestion: (p) => actualizarGestion(p.p_anio, p.p_estado, p.p_tasa, p.p_nota),
  }

  return {
    rpc(fn, params = {}) {
      const f = FUNCIONES[fn]
      if (!f) throw new ErrorDemo(`Función no disponible: ${fn}`)
      // copia profunda: la web nunca toca el estado interno por referencia
      return JSON.parse(JSON.stringify(f(params || {}) ?? null))
    },
    importacionDemo: () => ({
      importacion_id: 1, gestion: imp.gestion, archivo: imp.archivo, resumen: imp.resumen, validaciones: imp.validaciones,
      vista_previa: imp.vista_previa, demo: true,
    }),
  }
}
