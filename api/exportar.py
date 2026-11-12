"""Exporta reportes a Excel (con niveles que se pliegan, como la tabla dinámica) y a PDF."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

try:
    from zoneinfo import ZoneInfo
    LA_PAZ = ZoneInfo("America/La_Paz")
except Exception:  # noqa: BLE001
    LA_PAZ = timezone(timedelta(hours=-4))

DIMENSIONES = {"gestion": "Gestión", "mes": "Mes", "financiador": "Financiador", "region": "Región", "area": "Área",
               "rubro": "Rubro", "cuenta": "Cuenta", "cuenta_contable": "Cuenta contable"}
COLUMNAS = {
    "real": [("Presupuesto", "presupuesto", "num"), ("Modificaciones", "modificaciones", "num"),
             ("Vigente", "presupuesto_vigente", "num"), ("Ejecutado", "ejecutado", "num"),
             ("Saldo", "saldo", "num"), ("% Ejec.", "pct_ejecucion", "pct")],
    "excel": [("Presupuesto (Excel)", "presupuesto_excel", "num"), ("Ejecutado", "ejecutado", "num"),
              ("Saldo (Excel)", "saldo_excel", "num"), ("% Ejec. (Excel)", "pct_excel", "pct")],
}
COLUMNAS_MOV = [
    ("Fecha", "fecha", "fecha", 11), ("Mes", "mes", "int", 6), ("Tipo", "tipo", "int", 6), ("Nro.", "numero", "int", 7),
    ("Financiador", "financiador", "txt", 16), ("Región", "region", "txt", 8), ("Área", "area", "txt", 26),
    ("Rubro", "rubro_etiqueta", "txt", 24), ("Cuenta", "cuenta_etiqueta", "txt", 26),
    ("Cuenta contable", "cuenta_contable", "txt", 13), ("Nombre contable", "nombre_contable", "txt", 30),
    ("Glosa", "ref", "txt", 60), ("Debe Bs", "debe_bs", "num", 13), ("Haber Bs", "haber_bs", "num", 13),
    ("Ejecutado Bs", "ejecutado_bs", "num", 14), ("Ejecutado USD", "ejecutado_usd", "num", 14), ("Tasa", "tasa", "num4", 8),
]

AZUL = "417545"
GRIS = "F2F4F7"
CELESTE = "E6F2EC"


# ---------------------------------------------------------------------------
def ahora() -> datetime:
    return datetime.now(LA_PAZ)


def fmt_num(x, dec=2) -> str:
    if x is None:
        return ""
    s = f"{float(x):,.{dec}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def fmt_int(n) -> str:
    return f"{int(n):,}".replace(",", ".")


def fmt_pct(x) -> str:
    return "" if x is None else f"{float(x) * 100:.1f} %".replace(".", ",")


def preparar(filas: list[dict], criterio: str, dims: list[str]) -> list[dict]:
    """Agrega las columnas calculadas del reporte por mes (acumulado y % del presupuesto anual)."""
    if not (criterio == "real" and dims == ["mes"]):
        return filas
    total = next((f for f in filas if f.get("nivel") == 0), {})
    anual = float(total.get("presupuesto_vigente") or 0)
    suma, salida = 0.0, []
    for f in filas:
        g = dict(f)
        if f.get("nivel") == 1 and f.get("k1") != "0":
            suma += float(f.get("ejecutado") or 0)
            g["acumulado"] = suma
        elif f.get("nivel") == 0:
            g["acumulado"] = float(f.get("ejecutado") or 0)
        if g.get("acumulado") is not None and anual:
            g["pct_anual"] = g["acumulado"] / anual
        salida.append(g)
    return salida


def valor(fila: dict, clave: str):
    if clave == "saldo_excel":
        pe, e = fila.get("presupuesto_excel"), fila.get("ejecutado")
        return None if pe is None else float(pe) - float(e or 0)
    v = fila.get(clave)
    return None if v is None else float(v)


def etiqueta(fila: dict) -> str:
    n = int(fila.get("nivel") or 0)
    return fila.get("d1") or "Total general" if n == 0 else (fila.get(f"d{n}") or "")


def columnas(filas: list[dict], criterio: str, dims: list[str] | None = None):
    if criterio == "real" and dims == ["mes"]:
        # El presupuesto es casi todo anual: por mes se muestra el avance acumulado contra el año
        return [("Presupuesto del mes", "presupuesto_vigente", "num"), ("Ejecutado", "ejecutado", "num"),
                ("Ejecutado acumulado", "acumulado", "num"), ("% del presupuesto anual", "pct_anual", "pct")]
    cols = COLUMNAS[criterio]
    if criterio == "real" and all(not float(f.get("modificaciones") or 0) for f in filas):
        cols = [c for c in cols if c[1] not in ("modificaciones", "presupuesto_vigente")]
    return cols


def describir_filtros(filtros: dict | None, moneda: str = "BS") -> str:
    f = filtros or {}
    partes = []
    nombres = {"gestiones": "Gestión", "financiadores": "Financiador", "regiones": "Región", "areas": "Área",
               "rubros": "Rubro", "cuentas": "Cuenta", "cuentas_contables": "Cuenta contable", "meses": "Meses"}
    for k, n in nombres.items():
        v = f.get(k)
        if v:
            partes.append(f"{n}: {', '.join(map(str, v if isinstance(v, list) else [v]))}")
    if f.get("mes_desde") or f.get("mes_hasta"):
        partes.append(f"Meses {f.get('mes_desde', 1)} a {f.get('mes_hasta', 12)}")
    if f.get("texto"):
        partes.append(f"Texto: «{f['texto']}»")
    partes.append("Expresado en dólares" if str(moneda).upper() == "USD" else "Expresado en bolivianos")
    return " · ".join(partes)


def nombre_hoja(t: str) -> str:
    for c in '[]:*?/\\':
        t = t.replace(c, " ")
    return t[:31] or "Reporte"


# ---------------------------------------------------------------------------
# Excel
# ---------------------------------------------------------------------------
def reporte_xlsx(titulo: str, secciones: list[dict], filtros_txt: str, criterio: str = "real",
                 kpis: list[tuple[str, str]] | None = None, organizacion: str = "") -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    borde = Side(style="thin", color="9AA5B1")
    for i_sec, sec in enumerate(secciones):
        ws = wb.create_sheet(nombre_hoja(sec["titulo"]))
        ws.sheet_properties.outlinePr.summaryBelow = False
        filas = preparar(sec["filas"], criterio, sec["dimensiones"])
        cols = columnas(filas, criterio, sec["dimensiones"])
        n_dims = len(sec["dimensiones"])
        r = 1
        if organizacion:
            ws.cell(r, 1, organizacion).font = Font(bold=True, size=10, color="555555")
            r += 1
        ws.cell(r, 1, titulo).font = Font(bold=True, size=14, color=AZUL)
        r += 1
        if len(secciones) > 1:
            ws.cell(r, 1, sec["titulo"]).font = Font(bold=True, size=12)
            r += 1
        ws.cell(r, 1, f"{filtros_txt} · Generado {ahora():%d/%m/%Y %H:%M}").font = Font(italic=True, size=9, color="666666")
        r += 2
        if kpis and i_sec == 0:
            for nombre, v in kpis:
                ws.cell(r, 1, nombre).font = Font(color="555555")
                ws.cell(r, 2, v).font = Font(bold=True)
                r += 1
            r += 1
        cab = r
        encab = " › ".join(DIMENSIONES.get(d, d) for d in sec["dimensiones"]) or "Concepto"
        for j, nombre in enumerate([encab] + [c[0] for c in cols], start=1):
            c = ws.cell(cab, j, nombre)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor=AZUL)
            c.alignment = Alignment(horizontal="left" if j == 1 else "right", vertical="center", wrap_text=True)
        r = cab + 1
        for f in filas:
            nivel = int(f.get("nivel") or 0)
            es_total = nivel == 0
            es_sub = 0 < nivel < n_dims
            c = ws.cell(r, 1, etiqueta(f))
            c.alignment = Alignment(indent=max(nivel - 1, 0) * 2)
            for j, (_, clave, tipo) in enumerate(cols, start=2):
                v = valor(f, clave)
                c = ws.cell(r, j, v)
                c.number_format = "0.0%" if tipo == "pct" else "#,##0.00"
                if tipo == "pct" and v is not None and v > 1:
                    c.font = Font(bold=es_sub or es_total, color="B42318")
            if es_total or es_sub:
                for j in range(1, len(cols) + 2):
                    cel = ws.cell(r, j)
                    if cel.font.color is None or cel.font.color.rgb in (None, "FF000000"):
                        cel.font = Font(bold=True)
                    if es_total:
                        cel.fill = PatternFill("solid", fgColor=CELESTE)
                        cel.border = Border(top=borde)
                    elif nivel == 1 and n_dims > 1:
                        cel.fill = PatternFill("solid", fgColor=GRIS)
            if nivel >= 2:
                ws.row_dimensions[r].outline_level = min(nivel - 1, 7)
            r += 1
        ws.column_dimensions["A"].width = 46
        for j in range(2, len(cols) + 2):
            ws.column_dimensions[get_column_letter(j)].width = 17
        ws.freeze_panes = ws.cell(cab + 1, 2)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def movimientos_xlsx(titulo: str, filas: list[dict], filtros_txt: str, organizacion: str = "") -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Movimientos"
    r = 1
    if organizacion:
        ws.cell(r, 1, organizacion).font = Font(bold=True, size=10, color="555555")
        r += 1
    ws.cell(r, 1, titulo).font = Font(bold=True, size=14, color=AZUL)
    ws.cell(r + 1, 1, f"{filtros_txt} · {fmt_int(len(filas))} movimientos · Generado {ahora():%d/%m/%Y %H:%M}").font = \
        Font(italic=True, size=9, color="666666")
    cab = r + 3
    for j, (nombre, _, _, ancho) in enumerate(COLUMNAS_MOV, start=1):
        c = ws.cell(cab, j, nombre)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=AZUL)
        ws.column_dimensions[get_column_letter(j)].width = ancho
    for i, f in enumerate(filas, start=cab + 1):
        for j, (_, clave, tipo, _) in enumerate(COLUMNAS_MOV, start=1):
            v = f.get(clave)
            if tipo == "fecha" and v:
                v = datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
            elif tipo in ("num", "num4") and v is not None:
                v = float(v)
            c = ws.cell(i, j, v)
            if tipo == "fecha":
                c.number_format = "dd/mm/yyyy"
            elif tipo == "num":
                c.number_format = "#,##0.00"
            elif tipo == "num4":
                c.number_format = "0.00##"
    fin = cab + len(filas)
    tot = fin + 1
    ws.cell(tot, 1, "Total").font = Font(bold=True)
    for j, (_, clave, tipo, _) in enumerate(COLUMNAS_MOV, start=1):
        if tipo == "num":
            col = get_column_letter(j)
            c = ws.cell(tot, j, f"=SUBTOTAL(9,{col}{cab + 1}:{col}{fin})" if filas else 0)
            c.number_format = "#,##0.00"
            c.font = Font(bold=True)
    ws.auto_filter.ref = f"A{cab}:{get_column_letter(len(COLUMNAS_MOV))}{max(fin, cab)}"
    ws.freeze_panes = ws.cell(cab + 1, 1)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------
_E_TIT = ParagraphStyle("tit", fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=colors.HexColor("#" + AZUL))
_E_ORG = ParagraphStyle("org", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=colors.HexColor("#555555"))
_E_SUB = ParagraphStyle("sub", fontName="Helvetica-Oblique", fontSize=8.5, leading=11, textColor=colors.HexColor("#666666"))
_E_SEC = ParagraphStyle("sec", fontName="Helvetica-Bold", fontSize=11.5, leading=15, spaceBefore=8, spaceAfter=4)
_E_CEL = ParagraphStyle("cel", fontName="Helvetica", fontSize=8, leading=10)
_E_CEL_B = ParagraphStyle("celb", parent=_E_CEL, fontName="Helvetica-Bold")
_E_KPI_N = ParagraphStyle("kpin", fontName="Helvetica", fontSize=7.5, leading=9, textColor=colors.HexColor("#666666"))
_E_KPI_V = ParagraphStyle("kpiv", fontName="Helvetica-Bold", fontSize=11, leading=13)


def _escapar(t) -> str:
    return str(t or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _pie(organizacion: str):
    def dibujar(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#777777"))
        izq = f"{organizacion} · " if organizacion else ""
        canvas.drawString(doc.leftMargin, 8 * mm, f"{izq}Generado {ahora():%d/%m/%Y %H:%M} (hora de Bolivia)")
        canvas.drawRightString(doc.pagesize[0] - doc.rightMargin, 8 * mm, f"Página {doc.page}")
        canvas.restoreState()
    return dibujar


def _documento(buf, titulo):
    return SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm,
                             topMargin=12 * mm, bottomMargin=15 * mm, title=titulo)


def reporte_pdf(titulo: str, secciones: list[dict], filtros_txt: str, criterio: str = "real",
                kpis: list[tuple[str, str]] | None = None, organizacion: str = "") -> bytes:
    buf = BytesIO()
    doc = _documento(buf, titulo)
    ancho = doc.width
    story = []
    if organizacion:
        story.append(Paragraph(_escapar(organizacion), _E_ORG))
    story += [Paragraph(_escapar(titulo), _E_TIT), Paragraph(_escapar(filtros_txt), _E_SUB), Spacer(1, 6)]
    if kpis:
        celdas = [[Paragraph(_escapar(n), _E_KPI_N) for n, _ in kpis], [Paragraph(_escapar(v), _E_KPI_V) for _, v in kpis]]
        t = Table(celdas, colWidths=[ancho / len(kpis)] * len(kpis))
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#" + GRIS)),
                               ("LINEAFTER", (0, 0), (-2, -1), 0.5, colors.white),
                               ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        story += [t, Spacer(1, 8)]
    for sec in secciones:
        filas = preparar(sec["filas"], criterio, sec["dimensiones"])
        cols = columnas(filas, criterio, sec["dimensiones"])
        n_dims = len(sec["dimensiones"])
        if len(secciones) > 1:
            story.append(Paragraph(_escapar(sec["titulo"]), _E_SEC))
        encab = " › ".join(DIMENSIONES.get(d, d) for d in sec["dimensiones"]) or "Concepto"
        datos = [[Paragraph(f"<b>{_escapar(encab)}</b>", _E_CEL)] + [c[0] for c in cols]]
        estilos = [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#" + AZUL)), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#D0D5DD")),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ]
        for i, f in enumerate(filas, start=1):
            nivel = int(f.get("nivel") or 0)
            negrita = nivel < n_dims
            est = ParagraphStyle(f"n{nivel}{negrita}", parent=_E_CEL_B if negrita else _E_CEL, leftIndent=max(nivel - 1, 0) * 10)
            fila = [Paragraph(_escapar(etiqueta(f)), est)]
            for _, clave, tipo in cols:
                v = valor(f, clave)
                fila.append(fmt_pct(v) if tipo == "pct" else fmt_num(v))
                if tipo == "pct" and v is not None and v > 1:
                    estilos.append(("TEXTCOLOR", (len(fila) - 1, i), (len(fila) - 1, i), colors.HexColor("#B42318")))
            datos.append(fila)
            if negrita:
                estilos.append(("FONTNAME", (1, i), (-1, i), "Helvetica-Bold"))
            if nivel == 0:
                estilos += [("BACKGROUND", (0, i), (-1, i), colors.HexColor("#" + CELESTE)),
                            ("LINEABOVE", (0, i), (-1, i), 0.8, colors.HexColor("#9AA5B1"))]
            elif nivel == 1 and n_dims > 1:
                estilos.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#" + GRIS)))
        ancho_num = 27 * mm
        t = Table(datos, colWidths=[ancho - ancho_num * len(cols)] + [ancho_num] * len(cols), repeatRows=1)
        t.setStyle(TableStyle(estilos))
        story.append(t)
    doc.build(story, onFirstPage=_pie(organizacion), onLaterPages=_pie(organizacion))
    return buf.getvalue()


def movimientos_pdf(titulo: str, filas: list[dict], filtros_txt: str, organizacion: str = "") -> bytes:
    buf = BytesIO()
    doc = _documento(buf, titulo)
    pequeno = ParagraphStyle("p", parent=_E_CEL, fontSize=7, leading=8.5)
    story = []
    if organizacion:
        story.append(Paragraph(_escapar(organizacion), _E_ORG))
    total = sum(float(f.get("ejecutado_bs") or 0) for f in filas)
    story += [Paragraph(_escapar(titulo), _E_TIT),
              Paragraph(_escapar(f"{filtros_txt} · {fmt_int(len(filas))} movimientos · Total Bs {fmt_num(total)}"), _E_SUB),
              Spacer(1, 6)]
    datos = [["Fecha", "Financiador", "Área", "Rubro / Cuenta", "Glosa", "Ejecutado Bs"]]
    for f in filas:
        fecha = f.get("fecha")
        fecha = datetime.strptime(str(fecha)[:10], "%Y-%m-%d").strftime("%d/%m/%Y") if fecha else ""
        datos.append([fecha, Paragraph(_escapar(f.get("financiador")), pequeno), Paragraph(_escapar(f.get("area")), pequeno),
                      Paragraph(_escapar(f"{f.get('rubro_etiqueta')} / {f.get('cuenta_etiqueta')}"), pequeno),
                      Paragraph(_escapar(f.get("ref")), pequeno), fmt_num(f.get("ejecutado_bs"))])
    datos.append(["", "", "", "", Paragraph("<b>Total</b>", pequeno), fmt_num(total)])
    w = doc.width
    t = Table(datos, colWidths=[19 * mm, 30 * mm, 40 * mm, 55 * mm, w - 169 * mm, 25 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#" + AZUL)), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("ALIGN", (-1, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#D0D5DD")),
        ("FONTNAME", (-1, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#" + CELESTE)),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(t)
    doc.build(story, onFirstPage=_pie(organizacion), onLaterPages=_pie(organizacion))
    return buf.getvalue()
