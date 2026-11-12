"""Lee la hoja BD que exporta el sistema contable, la normaliza y la valida.

Uso directo, sin Supabase (imprime el informe de validación):
    python lector.py Prueba_ExB.xlsx [--gestion 2026] [--json]
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from io import BytesIO

from openpyxl import load_workbook

MESES = {
    "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6, "JULIO": 7, "AGOSTO": 8,
    "SEPTIEMBRE": 9, "SETIEMBRE": 9, "OCTUBRE": 10, "NOVIEMBRE": 11, "DICIEMBRE": 12,
}
NOMBRE_MES = {v: k.capitalize() for k, v in MESES.items() if k != "SETIEMBRE"}
REGIONES = {
    "LP": "La Paz", "SC": "Santa Cruz", "CB": "Cochabamba", "OR": "Oruro", "PT": "Potosí",
    "CH": "Chuquisaca", "TJ": "Tarija", "BE": "Beni", "PD": "Pando",
}

# Nombre interno → encabezados aceptados (ya normalizados: minúsculas, sin tildes, "_" = espacio)
COLUMNAS = {
    "mes": ("mes",),
    "codigo": ("codigo", "codigo contable", "cod"),
    "nombre": ("nombre", "nombre cuenta"),
    "fecha": ("cfecha", "fecha"),
    "tipo": ("tipo",),
    "numero": ("numero", "nro", "num"),
    "no_cheque": ("no cheque", "nro cheque", "cheque"),
    "region": ("region", "regional"),
    "ref": ("ref", "glosa", "referencia"),
    "debe": ("ejecucion", "debe"),
    "haber": ("haber",),
    "dsus": ("dsus", "debe usd"),
    "hsus": ("hsus", "haber usd"),
    "tasa": ("tasa", "tipo de cambio", "tc"),
    "fondo": ("fondo", "financiador", "fuente"),
    "rubro": ("rubro",),
    "cuenta": ("cuenta", "cuenta presupuestaria"),
    "area": ("area",),
    "presupuesto": ("presupuesto bs", "presupuesto"),
}
OBLIGATORIAS = ("mes", "fondo", "rubro", "area", "region")


class ErrorLectura(Exception):
    """El archivo no se puede importar (no tiene la hoja o las columnas esperadas)."""


@dataclass
class Lectura:
    gestion: int
    archivo: str
    sha256: str
    presupuestos: list[dict] = field(default_factory=list)
    movimientos: list[dict] = field(default_factory=list)
    validaciones: list[dict] = field(default_factory=list)
    resumen: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def normalizar(texto) -> str:
    s = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.replace("_", " ")).strip().lower()


def texto(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def numero(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "").replace("Bs", "").replace("$", "")
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def entero(v) -> int | None:
    n = numero(v)
    return int(n) if n is not None and float(n).is_integer() else None


def a_fecha(v) -> tuple[date | None, str]:
    """Devuelve (fecha, origen) con origen 'fecha', 'texto', 'vacia' o 'invalida'."""
    if v is None or v == "":
        return None, "vacia"
    if isinstance(v, datetime):
        return v.date(), "fecha"
    if isinstance(v, date):
        return v, "fecha"
    if isinstance(v, (int, float)) and 20000 < v < 80000:     # número de serie de Excel
        return date(1899, 12, 30) + timedelta(days=int(v)), "fecha"
    s = str(v).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date(), "texto"
        except ValueError:
            pass
    return None, "invalida"


_CODIGO = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s*(.*?)\s*$")


def separar_codigo(etiqueta: str) -> tuple[str, str]:
    """'4. Consultoria' → ('4', 'Consultoria'); '4.1 Videos' → ('4.1', 'Videos'); '9.2 ' → ('9.2', '')."""
    m = _CODIGO.match(etiqueta)
    if not m:
        return etiqueta, etiqueta
    return m.group(1), m.group(2)


def orden_de(codigo: str) -> list[int]:
    return [int(p) for p in codigo.split(".")] if re.fullmatch(r"\d+(?:\.\d+)*", codigo) else []


def r2(x) -> float:
    return round(float(x or 0) + 0.0, 2)


def bs(x) -> str:
    s = f"{float(x or 0):,.2f}"
    return "Bs " + s.replace(",", "§").replace(".", ",").replace("§", ".")


def pct(x) -> str:
    return f"{float(x or 0) * 100:.1f} %".replace(".", ",")


def num_es(x) -> str:
    return f"{float(x):g}".replace(".", ",")


def entero_es(n) -> str:
    return f"{int(n):,}".replace(",", ".")


def _validacion(codigo, severidad, titulo, detalle=None, filas=None, monto_bs=None, datos=None):
    return {"codigo": codigo, "severidad": severidad, "titulo": titulo, "detalle": detalle,
            "filas": filas, "monto_bs": None if monto_bs is None else r2(monto_bs), "datos": datos}


def _encabezado(ws, max_filas=20) -> tuple[int, dict[str, int]] | None:
    for r, fila in enumerate(ws.iter_rows(min_row=1, max_row=max_filas, values_only=True), start=1):
        nombres = [normalizar(c) for c in fila]
        if "rubro" in nombres and "mes" in nombres:
            cols: dict[str, int] = {}
            for interno, alias in COLUMNAS.items():
                for a in alias:
                    if a in nombres:
                        cols[interno] = nombres.index(a)
                        break
            return r, cols
    return None


# ---------------------------------------------------------------------------
# Lectura principal
# ---------------------------------------------------------------------------
def leer_excel(contenido: bytes, archivo: str = "archivo.xlsx", gestion: int | None = None, hoja: str = "BD") -> Lectura:
    try:
        wb = load_workbook(BytesIO(contenido), data_only=True, read_only=True)
    except Exception as e:  # noqa: BLE001
        raise ErrorLectura(f"No se pudo abrir el Excel: {e}") from e

    nombres_hojas = {normalizar(n): n for n in wb.sheetnames}
    nombre_bd = nombres_hojas.get(normalizar(hoja))
    if nombre_bd is None:   # sin hoja BD: la primera que tenga encabezados reconocibles
        for n in wb.sheetnames:
            enc = _encabezado(wb[n])
            if enc and all(c in enc[1] for c in OBLIGATORIAS):
                nombre_bd = n
                break
    if nombre_bd is None:
        raise ErrorLectura(f"No encontré la hoja «{hoja}» ni otra con columnas mes, fondo, rubro, área y región.")
    ws = wb[nombre_bd]
    enc = _encabezado(ws)
    if not enc:
        raise ErrorLectura(f"La hoja «{nombre_bd}» no tiene una fila de encabezados con «mes» y «rubro».")
    fila_enc, cols = enc
    faltan = [c for c in OBLIGATORIAS + ("presupuesto", "debe") if c not in cols]
    if faltan:
        raise ErrorLectura(f"Faltan columnas en «{nombre_bd}»: {', '.join(faltan)}.")

    sha = hashlib.sha256(contenido).hexdigest()
    crudas = []
    for r, fila in enumerate(ws.iter_rows(min_row=fila_enc + 1, values_only=True), start=fila_enc + 1):
        if fila is None or all(v is None or str(v).strip() == "" for v in fila):
            continue
        crudas.append((r, {k: (fila[i] if i < len(fila) else None) for k, i in cols.items()}))

    # Otras hojas con detalle (p. ej. las que crea Excel al hacer doble clic en una dinámica)
    otras = []
    for n in wb.sheetnames:
        if n == nombre_bd:
            continue
        e = _encabezado(wb[n])
        if e and "rubro" in e[1] and ("debe" in e[1] or "presupuesto" in e[1]):
            filas_o = []
            for fila in wb[n].iter_rows(min_row=e[0] + 1, values_only=True):
                g = lambda k: fila[e[1][k]] if k in e[1] and e[1][k] < len(fila) else None  # noqa: E731
                if g("rubro") is None:
                    continue
                filas_o.append({"rubro": texto(g("rubro")), "fondo": texto(g("fondo")), "monto": numero(g("debe")) or 0})
            otras.append((n, filas_o))
    wb.close()

    return _procesar(crudas, otras, archivo, sha, gestion, nombre_bd, fila_enc)


def _procesar(crudas, otras, archivo, sha, gestion, nombre_bd, fila_enc) -> Lectura:
    val: list[dict] = []
    omitidas: list[int] = []
    filas = []

    # 1. Normalizar fila por fila
    tipos_fecha = Counter()
    fechas_invalidas, fechas_invertidas, fechas_mes_distinto = [], [], []
    for r, c in crudas:
        mes_txt = (texto(c.get("mes")) or "").upper()
        ref = texto(c.get("ref"))
        debe, haber = numero(c.get("debe")), numero(c.get("haber"))
        pres = numero(c.get("presupuesto"))
        es_pres = mes_txt == "PTTO" or normalizar(ref) == "presupuesto" or (debe is None and haber is None and pres is not None)
        mes = MESES.get(mes_txt)
        oblig = {k: texto(c.get(k)) for k in OBLIGATORIAS}
        if any(v is None for v in oblig.values()) or (mes is None and mes_txt != "PTTO") or (not es_pres and mes is None):
            omitidas.append(r)
            continue

        f, origen = (None, "vacia") if es_pres and mes_txt == "PTTO" else a_fecha(c.get("fecha"))
        if not es_pres:
            tipos_fecha[origen] += 1
            if origen == "invalida":
                fechas_invalidas.append(r)
            if f and mes and f.month != mes:
                if origen == "fecha" and f.day == mes and f.month <= 12 and f.day <= 12:
                    f = date(f.year, f.day, f.month)          # Excel volteó día y mes
                    fechas_invertidas.append(r)
                else:
                    fechas_mes_distinto.append(r)

        filas.append({
            "fila": r, "es_pres": es_pres, "mes": mes, "mes_txt": mes_txt, "fecha": f,
            "region": oblig["region"].upper(), "fondo": oblig["fondo"], "area": oblig["area"],
            "rubro_lbl": oblig["rubro"], "cuenta_lbl": texto(c.get("cuenta")),
            "ref": ref, "debe": debe, "haber": haber, "pres": pres,
            "dsus": numero(c.get("dsus")), "hsus": numero(c.get("hsus")), "tasa": numero(c.get("tasa")),
            "tipo": entero(c.get("tipo")), "numero": entero(c.get("numero")), "no_cheque": texto(c.get("no_cheque")),
            "codigo": texto(c.get("codigo")), "nombre": texto(c.get("nombre")),
        })

    if not filas:
        raise ErrorLectura(f"La hoja «{nombre_bd}» no tiene filas válidas.")

    # 2. Gestión
    if gestion is None:
        anios = Counter(x["fecha"].year for x in filas if x["fecha"] and not x["es_pres"])
        m = re.search(r"20\d\d", archivo or "")
        gestion = anios.most_common(1)[0][0] if anios else int(m.group()) if m else date.today().year

    # 3. Catálogos unificados por código (así '9.2 ' y '9.2 Expensas' son la misma cuenta)
    def catalogo(etiquetas):
        por_codigo = defaultdict(Counter)
        for e in etiquetas:
            codigo, _ = separar_codigo(e)
            por_codigo[codigo][e] += 1
        cat = {}
        for codigo, cnt in por_codigo.items():
            con_nombre = [(e, n) for e, n in cnt.most_common() if separar_codigo(e)[1]]
            etiqueta = con_nombre[0][0] if con_nombre else codigo
            cat[codigo] = {"codigo": codigo, "nombre": separar_codigo(etiqueta)[1] or codigo, "etiqueta": etiqueta,
                           "orden": orden_de(codigo), "variantes": sorted(cnt)}
        return cat

    rubros = catalogo(x["rubro_lbl"] for x in filas)
    cuentas = catalogo(x["cuenta_lbl"] for x in filas if x["cuenta_lbl"])
    nombres_contables = defaultdict(Counter)
    for x in filas:
        if x["codigo"] and not x["es_pres"]:
            nombres_contables[x["codigo"]][x["nombre"]] += 1

    # 4. Filas de salida con clave estable (contenido + número de aparición)
    vistas = Counter()
    pres_out, mov_out = [], []
    for x in filas:
        rub = separar_codigo(x["rubro_lbl"])[0]
        cue = separar_codigo(x["cuenta_lbl"])[0] if x["cuenta_lbl"] else None
        contenido = json.dumps([
            "P" if x["es_pres"] else "M", x["mes_txt"], x["fecha"].isoformat() if x["fecha"] else None, x["tipo"], x["numero"],
            x["no_cheque"], x["region"], x["ref"], x["debe"], x["haber"], x["dsus"], x["hsus"], x["tasa"], x["fondo"],
            x["rubro_lbl"], x["cuenta_lbl"], x["area"], x["codigo"], x["nombre"], x["pres"],
        ], ensure_ascii=False, separators=(",", ":"), default=str)
        n = vistas[contenido]
        vistas[contenido] += 1
        clave = hashlib.sha256(f"{contenido}#{n}".encode()).hexdigest()[:32]
        comun = {
            "fila": x["fila"], "financiador": x["fondo"], "region": x["region"],
            "region_nombre": REGIONES.get(x["region"], x["region"]), "area": x["area"],
            "rubro": rub, "rubro_nombre": rubros[rub]["nombre"], "rubro_etiqueta": rubros[rub]["etiqueta"],
            "rubro_orden": rubros[rub]["orden"],
            "cuenta": cue, "cuenta_nombre": cuentas[cue]["nombre"] if cue else None,
            "cuenta_etiqueta": cuentas[cue]["etiqueta"] if cue else None,
            "cuenta_orden": cuentas[cue]["orden"] if cue else [],
            "cuenta_rubro": cue.split(".")[0] if cue else None,
        }
        if x["es_pres"]:
            pres_out.append({"tipo": "presupuesto", "clave": clave,
                             "datos": {**comun, "mes": x["mes"], "monto_bs": r2(x["pres"])}})
        else:
            mov_out.append({"tipo": "movimiento", "clave": clave, "datos": {
                **comun, "mes": x["mes"], "fecha": x["fecha"].isoformat() if x["fecha"] else None,
                "tipo": x["tipo"], "numero": x["numero"], "no_cheque": x["no_cheque"], "ref": x["ref"],
                "cuenta_contable": x["codigo"],
                "nombre_contable": x["nombre"] if not x["codigo"] else nombres_contables[x["codigo"]].most_common(1)[0][0],
                "debe_bs": r2(x["debe"]), "haber_bs": r2(x["haber"]), "debe_usd": r2(x["dsus"]), "haber_usd": r2(x["hsus"]),
                "tasa": x["tasa"], "monto_bs": r2((x["debe"] or 0) - (x["haber"] or 0)),
            }})

    # 5. Totales
    P = [x for x in filas if x["es_pres"]]
    M = [x for x in filas if not x["es_pres"]]
    ejec = lambda x: (x["debe"] or 0) - (x["haber"] or 0)  # noqa: E731
    pres_real = sum(x["pres"] or 0 for x in P)
    ejecutado = sum(ejec(x) for x in M)
    pres_en_mov = sum(x["pres"] or 0 for x in M)
    pres_excel = pres_real + pres_en_mov
    pct_real = ejecutado / pres_real if pres_real else 0
    pct_excel = ejecutado / pres_excel if pres_excel else 0

    # 6. Validaciones -------------------------------------------------------
    if omitidas:
        val.append(_validacion(
            "FILAS_INCOMPLETAS", "error", f"{entero_es(len(omitidas))} filas sin mes, fondo, rubro, área o región: no se importan",
            "Corrígelas en el sistema contable y vuelve a importar.", len(omitidas), None, {"filas": omitidas[:50]}))

    dup = [x for x in M if x["pres"] is not None and abs((x["pres"] or 0) - ejec(x)) < 0.005]
    otro = [x for x in M if x["pres"] is not None and abs((x["pres"] or 0) - ejec(x)) >= 0.005]
    if dup:
        val.append(_validacion(
            "PRESUPUESTO_DUPLICA_EJECUCION", "advertencia",
            f"{entero_es(len(dup))} movimientos repiten su monto en «presupuesto Bs»",
            f"Las tablas dinámicas suman ese gasto como presupuesto: muestran {bs(pres_excel)} y {pct(pct_excel)} de ejecución. "
            f"Con solo las filas de presupuesto ({bs(pres_real)}) la ejecución real es {pct(pct_real)}. "
            "El sistema guarda el presupuesto real y además informa el criterio del Excel para cuadrar.",
            len(dup), sum(x["pres"] for x in dup),
            {"presupuesto_excel": r2(pres_excel), "presupuesto_real": r2(pres_real), "ejecutado": r2(ejecutado),
             "pct_excel": round(pct_excel, 4), "pct_real": round(pct_real, 4)}))
    if otro:
        val.append(_validacion(
            "PRESUPUESTO_EN_MOVIMIENTO", "advertencia",
            f"{entero_es(len(otro))} movimientos traen en «presupuesto Bs» un monto distinto a su gasto",
            "Ese monto no se toma como presupuesto. Revisa si debía ser una fila de presupuesto aparte.",
            len(otro), sum(x["pres"] for x in otro), {"filas": [x["fila"] for x in otro][:50]}))

    pres_rubro, ejec_rubro, meses_rubro = defaultdict(float), defaultdict(float), defaultdict(set)
    for x in P:
        pres_rubro[separar_codigo(x["rubro_lbl"])[0]] += x["pres"] or 0
    for x in M:
        cod = separar_codigo(x["rubro_lbl"])[0]
        ejec_rubro[cod] += ejec(x)
    for cod, p in sorted(pres_rubro.items(), key=lambda kv: orden_de(kv[0])):
        if p > 0 and abs(ejec_rubro.get(cod, 0)) < 0.005:
            val.append(_validacion(
                "RUBRO_SIN_EJECUCION", "advertencia", f"«{rubros[cod]['etiqueta']}» tiene presupuesto pero ningún gasto registrado",
                f"{bs(p)} presupuestados y 0 ejecutado en la gestión. Si hubo gastos, no están cargados en la BD con este rubro.",
                None, p, {"rubro": cod}))

    # Valores que aparecen en otras hojas con detalle pero no en BD
    rub_bd = {normalizar(x["rubro_lbl"]) for x in filas}
    fon_bd = {normalizar(x["fondo"]) for x in filas}
    for nombre_hoja, filas_o in otras:
        r_fuera = Counter(); r_monto = defaultdict(float); f_fuera = Counter()
        for y in filas_o:
            if y["rubro"] and normalizar(y["rubro"]) not in rub_bd:
                r_fuera[y["rubro"]] += 1
                r_monto[y["rubro"]] += y["monto"]
            if y["fondo"] and normalizar(y["fondo"]) not in fon_bd:
                f_fuera[y["fondo"]] += 1
        if r_fuera or f_fuera:
            partes = []
            if r_fuera:
                partes.append("rubros " + ", ".join(f"«{k}» ({entero_es(v)} filas, {bs(r_monto[k])})" for k, v in r_fuera.most_common()))
            if f_fuera:
                partes.append("fondos " + ", ".join(f"«{k}»" for k, _ in f_fuera.most_common(6)))
            val.append(_validacion(
                "CODIGOS_EN_OTRA_HOJA", "advertencia", f"La hoja «{nombre_hoja}» usa códigos que no existen en BD",
                "Tiene " + "; y ".join(partes) + ". Puede ser un extracto con otra codificación: confirma cuál es la vigente.",
                sum(r_fuera.values()) or sum(f_fuera.values()), sum(r_monto.values()) or None,
                {"hoja": nombre_hoja, "rubros": dict(r_fuera), "fondos": dict(f_fuera)}))

    # Gasto en combinaciones sin presupuesto
    clave_dim = lambda x: (x["fondo"], x["region"], x["area"], separar_codigo(x["rubro_lbl"])[0],  # noqa: E731
                           separar_codigo(x["cuenta_lbl"])[0] if x["cuenta_lbl"] else None)
    pres_dim = defaultdict(float)
    for x in P:
        pres_dim[clave_dim(x)] += x["pres"] or 0
    sin_pres = defaultdict(lambda: [0, 0.0])
    for x in M:
        k = clave_dim(x)
        if pres_dim.get(k, 0) <= 0:
            sin_pres[k][0] += 1
            sin_pres[k][1] += ejec(x)
    if sin_pres:
        tot = sum(v[1] for v in sin_pres.values())
        val.append(_validacion(
            "GASTO_SIN_PRESUPUESTO", "advertencia",
            f"{entero_es(len(sin_pres))} combinaciones tienen gasto pero no presupuesto",
            f"Suman {bs(tot)} ejecutados en fondo/región/área/rubro/cuenta sin presupuesto asignado. "
            "Saldrán como sobregiro hasta que se registre una modificación.",
            sum(v[0] for v in sin_pres.values()), tot,
            {"combinaciones": [{"financiador": k[0], "region": k[1], "area": k[2], "rubro": k[3], "cuenta": k[4],
                                "filas": v[0], "ejecutado": r2(v[1])} for k, v in sorted(sin_pres.items(), key=lambda kv: -kv[1][1])]}))

    fuera = defaultdict(lambda: [0, 0.0])
    for x in filas:
        if not x["cuenta_lbl"]:
            continue
        rub, cue = separar_codigo(x["rubro_lbl"])[0], separar_codigo(x["cuenta_lbl"])[0]
        if cue.split(".")[0] != rub:
            fuera[(rub, cue)][0] += 1
            fuera[(rub, cue)][1] += (x["pres"] or 0) if x["es_pres"] else ejec(x)
    if fuera:
        val.append(_validacion(
            "CUENTA_FUERA_DE_RUBRO", "advertencia", f"{entero_es(len(fuera))} cuentas están cargadas bajo un rubro que no es el suyo",
            "Por ejemplo " + ", ".join(f"«{cuentas[c]['etiqueta']}» dentro de «{rubros[r]['etiqueta']}»" for r, c in list(fuera)[:4])
            + ". Se respetan tal como vienen; revisa si es un error de codificación.",
            sum(v[0] for v in fuera.values()), sum(v[1] for v in fuera.values()),
            {"casos": [{"rubro": r, "cuenta": c, "filas": v[0], "monto": r2(v[1])} for (r, c), v in fuera.items()]}))

    unificadas = [(cat[c]["etiqueta"], cat[c]["variantes"]) for cat in (rubros, cuentas) for c in cat if len(cat[c]["variantes"]) > 1]
    if unificadas:
        val.append(_validacion(
            "ETIQUETAS_UNIFICADAS", "info",
            (f"{len(unificadas)} códigos venían escritos de varias formas y se unificaron" if len(unificadas) > 1
             else "Un código venía escrito de dos formas y se unificó"),
            "; ".join(f"{', '.join(repr(v) for v in variantes)} → «{et}»" for et, variantes in unificadas[:6]) + ".",
            None, None, {"casos": [{"etiqueta": e, "variantes": v} for e, v in unificadas]}))

    mensual = [x for x in P if x["mes"]]
    if mensual:
        val.append(_validacion(
            "PRESUPUESTO_MENSUALIZADO", "info",
            f"{entero_es(len(mensual))} filas de presupuesto vienen asignadas a un mes",
            f"Suman {bs(sum(x['pres'] or 0 for x in mensual))} (rubros "
            + ", ".join(sorted({rubros[separar_codigo(x['rubro_lbl'])[0]]['etiqueta'] for x in mensual})) + "). El resto es presupuesto anual.",
            len(mensual), sum(x["pres"] or 0 for x in mensual)))

    if M and pres_real:
        por_mes_e, por_mes_p = defaultdict(float), defaultdict(float)
        for x in M:
            por_mes_e[x["mes"]] += ejec(x)
            por_mes_p[x["mes"]] += x["pres"] or 0
        for x in mensual:
            por_mes_p[x["mes"]] += x["pres"] or 0
        excel_mes = {m: por_mes_e[m] / por_mes_p[m] for m in por_mes_e if por_mes_p[m]}
        ritmo = {m: por_mes_e[m] / (pres_real / 12) for m in por_mes_e}
        if excel_mes:
            val.append(_validacion(
                "REPORTE_POR_MES_ENGANOSO", "info", "El reporte por mes del Excel no mide ejecución real",
                f"Cada mes sale con {pct(min(excel_mes.values()))} a {pct(max(excel_mes.values()))} de ejecución porque su «presupuesto» "
                f"es su propio gasto. Contra el presupuesto anual ÷ 12, el gasto mensual va de {pct(min(ritmo.values()))} "
                f"a {pct(max(ritmo.values()))}.",
                None, None, {"pct_excel": {NOMBRE_MES[m]: round(v, 4) for m, v in sorted(excel_mes.items())},
                             "ritmo_real": {NOMBRE_MES[m]: round(v, 4) for m, v in sorted(ritmo.items())}}))

    if tipos_fecha["texto"]:
        val.append(_validacion(
            "FECHAS_COMO_TEXTO", "info", f"{entero_es(tipos_fecha['texto'])} fechas venían como texto y {entero_es(tipos_fecha['fecha'])} como fecha",
            "Se normalizaron todas a fecha (día/mes/año).", tipos_fecha["texto"]))
    if fechas_invertidas:
        val.append(_validacion(
            "FECHAS_INVERTIDAS", "advertencia", f"{entero_es(len(fechas_invertidas))} fechas tenían el día y el mes cruzados",
            "Excel las había leído como mes/día. Se corrigieron usando la columna «mes».",
            len(fechas_invertidas), None, {"filas": fechas_invertidas[:50]}))
    if fechas_mes_distinto:
        val.append(_validacion(
            "FECHA_Y_MES_NO_COINCIDEN", "advertencia", f"{entero_es(len(fechas_mes_distinto))} movimientos con fecha de otro mes",
            "Se reportan en el mes de la columna «mes» (periodo contable).",
            len(fechas_mes_distinto), None, {"filas": fechas_mes_distinto[:50]}))
    if fechas_invalidas:
        val.append(_validacion(
            "FECHAS_INVALIDAS", "advertencia", f"{entero_es(len(fechas_invalidas))} movimientos con fecha ilegible",
            "Se importan sin fecha, con su mes.", len(fechas_invalidas), None, {"filas": fechas_invalidas[:50]}))
    fuera_gestion = [x["fila"] for x in M if x["fecha"] and x["fecha"].year != gestion]
    if fuera_gestion:
        val.append(_validacion(
            "FECHAS_FUERA_DE_GESTION", "advertencia", f"{entero_es(len(fuera_gestion))} movimientos con fecha fuera de la gestión {gestion}",
            "Revisa que estés importando en la gestión correcta.", len(fuera_gestion), None, {"filas": fuera_gestion[:50]}))

    tc_mal = [x for x in M if x["tasa"] and x["dsus"] is not None and ejec(x)
              and abs(((x["dsus"] or 0) - (x["hsus"] or 0)) * x["tasa"] - ejec(x)) > max(1, 0.01 * abs(ejec(x)))]
    if tc_mal:
        val.append(_validacion(
            "TIPO_DE_CAMBIO_NO_CUADRA", "advertencia", f"{entero_es(len(tc_mal))} movimientos donde USD × tasa no da el monto en Bs",
            "; ".join(f"fila {x['fila']}: {num_es(x['dsus'])} USD × {num_es(x['tasa'])} = {bs(x['dsus'] * x['tasa'])}, pero dice {bs(ejec(x))}" for x in tc_mal[:3]) + ".",
            len(tc_mal), sum(ejec(x) for x in tc_mal), {"filas": [x["fila"] for x in tc_mal][:50]}))
    tasas = [x["tasa"] for x in M if x["tasa"]]
    if tasas and len(set(tasas)) > 1:
        por_dia = defaultdict(set)
        for x in M:
            if x["tasa"] and x["fecha"]:
                por_dia[x["fecha"]].add(x["tasa"])
        val.append(_validacion(
            "VARIOS_TIPOS_DE_CAMBIO", "info", f"{len(set(tasas))} tipos de cambio distintos, de {num_es(min(tasas))} a {num_es(max(tasas))} Bs/USD",
            f"{sum(1 for v in por_dia.values() if len(v) > 1)} días tienen más de una tasa. Quedan en la tabla tipos_cambio; "
            "los reportes en USD usan el monto en dólares de cada movimiento.",
            None, None, {"min": min(tasas), "max": max(tasas), "distintas": len(set(tasas))}))

    repetidas = sum(n - 1 for n in vistas.values() if n > 1)
    if repetidas:
        val.append(_validacion(
            "FILAS_IDENTICAS", "info", f"{entero_es(repetidas)} filas son idénticas a otra",
            "Se conservan todas (pueden ser pagos iguales). Cada copia tiene su propia clave, así reimportar no las duplica ni las pierde.",
            repetidas))

    orden_sev = {"error": 0, "advertencia": 1, "info": 2}
    val.sort(key=lambda v: orden_sev[v["severidad"]])

    fechas_mov = [x["fecha"] for x in M if x["fecha"]]
    resumen = {
        "hoja": nombre_bd, "fila_encabezado": fila_enc, "gestion": gestion,
        "filas_leidas": len(crudas), "filas_omitidas": len(omitidas),
        "presupuesto": {"filas": len(P), "monto_bs": r2(pres_real),
                        "anual_bs": r2(sum(x["pres"] or 0 for x in P if not x["mes"])),
                        "mensual_bs": r2(sum(x["pres"] or 0 for x in P if x["mes"]))},
        "movimientos": {"filas": len(M), "ejecutado_bs": r2(ejecutado),
                        "ejecutado_usd": r2(sum((x["dsus"] or 0) - (x["hsus"] or 0) for x in M)),
                        "desde": min(fechas_mov).isoformat() if fechas_mov else None,
                        "hasta": max(fechas_mov).isoformat() if fechas_mov else None,
                        "meses": sorted({x["mes"] for x in M})},
        "pct_ejecucion": round(pct_real, 4),
        "presupuesto_excel_bs": r2(pres_excel), "pct_excel": round(pct_excel, 4),
        "catalogos": {"financiadores": len({x["fondo"] for x in filas}), "regiones": len({x["region"] for x in filas}),
                      "areas": len({x["area"] for x in filas}), "rubros": len(rubros), "cuentas": len(cuentas)},
        "validaciones": dict(Counter(v["severidad"] for v in val)),
    }
    return Lectura(gestion=gestion, archivo=archivo, sha256=sha, presupuestos=pres_out, movimientos=mov_out,
                   validaciones=val, resumen=resumen)


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Valida el Excel del sistema contable sin subir nada.")
    ap.add_argument("archivo")
    ap.add_argument("--gestion", type=int)
    ap.add_argument("--json", action="store_true", help="imprime todo en JSON")
    a = ap.parse_args()
    with open(a.archivo, "rb") as fh:
        lec = leer_excel(fh.read(), a.archivo, a.gestion)
    if a.json:
        print(json.dumps({"gestion": lec.gestion, "resumen": lec.resumen, "validaciones": lec.validaciones},
                         ensure_ascii=False, indent=2, default=str))
        sys.exit(0)
    s = lec.resumen
    print(f"Gestión {lec.gestion} · hoja «{s['hoja']}» · {entero_es(s['filas_leidas'])} filas")
    print(f"  Presupuesto: {entero_es(s['presupuesto']['filas'])} filas, {bs(s['presupuesto']['monto_bs'])}")
    print(f"  Movimientos: {entero_es(s['movimientos']['filas'])} filas, {bs(s['movimientos']['ejecutado_bs'])}")
    print(f"  Ejecución real {pct(s['pct_ejecucion'])} · según el Excel {pct(s['pct_excel'])}\n")
    marca = {"error": "✖", "advertencia": "▲", "info": "·"}
    for v in lec.validaciones:
        print(f"{marca[v['severidad']]} [{v['codigo']}] {v['titulo']}")
        if v["detalle"]:
            print(f"    {v['detalle']}")
