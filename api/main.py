"""API del Control Presupuestario.

Dos modos, la misma web y los mismos reportes:
  MODO=supabase  la base y el login son de Supabase; la API solo importa el Excel y exporta.
                 Variables: SUPABASE_URL, SUPABASE_KEY (publishable key).
  MODO=postgres  FastAPI + SQLAlchemy contra un PostgreSQL propio; la API también hace el login
                 y atiende todas las consultas de la web. Variables: DATABASE_URL, JWT_SECRETO,
                 ADMIN_EMAIL y ADMIN_CLAVE (crean el primer admin al arrancar).

Si existe ../web/dist, la API también sirve la web en la misma dirección.

    uvicorn main:app --reload
"""
from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from datos import DriverPostgres, MotorPostgres, Supabase
from exportar import (ahora, describir_filtros, fmt_num, fmt_pct, movimientos_pdf, movimientos_xlsx,
                      reporte_pdf, reporte_xlsx)
from lector import ErrorLectura, leer_excel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("api")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")          # publishable key (sb_publishable_...)
DATABASE_URL = os.environ.get("DATABASE_URL", "")
MODO = os.environ.get("MODO", "postgres" if DATABASE_URL and not SUPABASE_URL else "supabase").lower()
ORGANIZACION = os.environ.get("ORGANIZACION", "")           # encabezado de reportes y de la web
ORIGENES = [o.strip() for o in os.environ.get("ORIGENES", "*").split(",") if o.strip()]
WEB_DIST = Path(os.environ.get("WEB_DIST", Path(__file__).resolve().parent.parent / "web" / "dist"))
MAX_MB = 15
LOTE = 1000

REPORTES: dict[str, dict[str, Any]] = {
    "rubro-cuenta":     {"titulo": "Ejecución por rubro y cuenta",     "dimensiones": ["rubro", "cuenta"]},
    "financiador":      {"titulo": "Ejecución por financiador",        "dimensiones": ["financiador", "rubro"]},
    "area-financiador": {"titulo": "Ejecución por área y financiador", "dimensiones": ["area", "financiador", "rubro"]},
    "region":           {"titulo": "Ejecución por región",             "dimensiones": ["region", "area", "financiador", "rubro", "cuenta"]},
    "mes":              {"titulo": "Ejecución por mes",                "dimensiones": ["mes"]},
    "movimientos":      {"titulo": "Detalle de movimientos",           "dimensiones": None},
    "resumen":          {"titulo": "Resumen general consolidado",      "dimensiones": None},
    "comparativo":      {"titulo": "Comparativo por gestiones",        "dimensiones": ["rubro", "gestion"]},
}

# Funciones SQL que la web puede llamar por /rpc (las de importación tienen rutas propias)
RPC_WEB = {
    "mi_perfil", "rol_actual", "catalogos", "version_datos", "reporte_json", "detalle_movimientos",
    "resumen_general", "alertas_ejecucion", "listar_importaciones", "validaciones_de", "listar_modificaciones",
    "registrar_modificacion", "eliminar_modificacion", "listar_usuarios", "cambiar_rol", "listar_auditoria",
    "actualizar_gestion",
}

@asynccontextmanager
async def ciclo(_app):
    arrancar()
    yield


app = FastAPI(title="Control Presupuestario · API", version="2.0", lifespan=ciclo)
app.add_middleware(CORSMiddleware, allow_origins=ORIGENES, allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["Content-Disposition"])

_motor: MotorPostgres | None = None


def motor() -> MotorPostgres:
    global _motor
    if _motor is None:
        if not DATABASE_URL:
            raise HTTPException(500, "Configura DATABASE_URL en el servidor")
        _motor = MotorPostgres(DATABASE_URL)
    return _motor


def arrancar() -> None:
    log.info("Modo %s · web %s", MODO, "servida desde " + str(WEB_DIST) if WEB_DIST.is_dir() else "no incluida")
    if MODO != "postgres":
        return
    from autenticacion import hash_clave
    email, clave = os.environ.get("ADMIN_EMAIL", ""), os.environ.get("ADMIN_CLAVE", "")
    if email and clave and not motor().existe_email(email):
        motor().crear_usuario(email, hash_clave(clave), "admin")
        log.info("Admin inicial creado: %s", email)


# ---------------------------------------------------------------------------
# Quién llama
# ---------------------------------------------------------------------------
def _token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Falta el token de sesión (Authorization: Bearer ...)")
    return authorization.split(" ", 1)[1].strip()


def cliente(authorization: str | None = Header(None)):
    token = _token(authorization)
    if MODO == "postgres":
        from autenticacion import leer_token
        return DriverPostgres(motor(), leer_token(token)["sub"])
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(500, "Configura SUPABASE_URL y SUPABASE_KEY en el servidor")
    return Supabase(SUPABASE_URL, SUPABASE_KEY, token)


def solo_postgres() -> None:
    if MODO != "postgres":
        raise HTTPException(400, "En modo supabase el inicio de sesión y los usuarios los maneja Supabase")


def _archivo(nombre: str, ext: str) -> dict[str, str]:
    base = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9]+", "-", base).strip("-").lower() or "reporte"
    return {"Content-Disposition": f'attachment; filename="{base}-{ahora():%Y%m%d-%H%M}.{ext}"'}


TIPOS = {"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "pdf": "application/pdf"}


# ---------------------------------------------------------------------------
# Rutas generales
# ---------------------------------------------------------------------------
@app.get("/salud")
def salud():
    return {"ok": True, "modo": MODO, "web": WEB_DIST.is_dir()}


@app.get("/config.js", include_in_schema=False)
def config_js():
    """Cuando la API sirve la web, le dice en qué modo trabajar (pisa web/dist/config.js)."""
    cfg = {"MODO": "api" if MODO == "postgres" else "supabase", "API_URL": "", "ORGANIZACION": ORGANIZACION}
    if MODO != "postgres":
        cfg |= {"SUPABASE_URL": SUPABASE_URL, "SUPABASE_KEY": SUPABASE_KEY}
    js = (f"window.CONFIG = {json.dumps(cfg, ensure_ascii=False)};\n"
          "window.CONFIG.API_URL = window.location.origin;  // la API es este mismo servidor\n")
    return Response(js, media_type="application/javascript", headers={"Cache-Control": "no-store"})


@app.get("/reportes")
def reportes():
    """Los 7 informes del reto (más el comparativo) con sus dimensiones por defecto."""
    return [{"clave": k, **v} for k, v in REPORTES.items()]


@app.post("/rpc/{funcion}")
async def rpc(funcion: str, params: dict = Body(default_factory=dict), sb=Depends(cliente)):
    """Puerta única de la web hacia las funciones SQL (las mismas que usa en modo Supabase)."""
    if funcion not in RPC_WEB:
        raise HTTPException(404, f"Función no disponible: {funcion}")
    return await sb.rpc(funcion, params or {})


# ---------------------------------------------------------------------------
# Sesión (solo modo postgres)
# ---------------------------------------------------------------------------
class Credenciales(BaseModel):
    email: str
    clave: str


class NuevoUsuario(BaseModel):
    email: str
    clave: str
    rol: Literal["admin", "tecnico", "lector"] = "lector"


@app.post("/auth/login")
async def login(c: Credenciales):
    solo_postgres()
    from autenticacion import emitir_token, verificar_clave
    fila = await run_in_threadpool(motor().buscar_credencial, c.email)
    if not fila or not verificar_clave(c.clave, fila[1]):
        raise HTTPException(401, "Correo o contraseña incorrectos")
    uid = fila[0]
    perfil = await DriverPostgres(motor(), uid).rpc("mi_perfil", {})
    return {"token": emitir_token(uid, c.email.strip().lower()), "perfil": perfil}


@app.get("/auth/yo")
async def yo(sb=Depends(cliente)):
    perfil = await sb.rpc("mi_perfil", {})
    if not perfil:
        raise HTTPException(401, "Tu usuario no tiene perfil")
    return perfil


@app.post("/auth/usuarios")
async def crear_usuario(u: NuevoUsuario, sb=Depends(cliente)):
    solo_postgres()
    from autenticacion import hash_clave
    if not await sb.rpc("es_admin", {}):
        raise HTTPException(403, "Solo un admin puede crear usuarios")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", u.email.strip()):
        raise HTTPException(400, "Correo inválido")
    uid = await run_in_threadpool(motor().crear_usuario, u.email, hash_clave(u.clave), u.rol, sb.uid)
    return {"user_id": uid}


@app.put("/auth/usuarios/{uid}/clave")
async def cambiar_clave(uid: str, clave: str = Body(..., embed=True), sb=Depends(cliente)):
    solo_postgres()
    from autenticacion import hash_clave
    if uid != sb.uid and not await sb.rpc("es_admin", {}):
        raise HTTPException(403, "Solo un admin puede cambiar la contraseña de otro usuario")
    await run_in_threadpool(motor().cambiar_clave, uid, hash_clave(clave), sb.uid)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Importación
# ---------------------------------------------------------------------------
@app.post("/importaciones")
async def importar(archivo: UploadFile = File(...), gestion: int | None = Form(None),
                   modo: Literal["sincronizar", "agregar"] = Form("sincronizar"), sb=Depends(cliente)):
    """Lee el Excel, lo valida y lo deja como borrador. No cambia los datos hasta /confirmar."""
    nombre = archivo.filename or "archivo.xlsx"
    if not nombre.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(415, "Sube el archivo en formato .xlsx")
    contenido = await archivo.read(MAX_MB * 1024 * 1024 + 1)
    if len(contenido) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"El archivo pasa de {MAX_MB} MB")
    try:
        lec = await run_in_threadpool(leer_excel, contenido, nombre, gestion)
    except ErrorLectura as e:
        raise HTTPException(422, str(e)) from e

    imp_id = await sb.rpc("importacion_iniciar", {
        "p_gestion": lec.gestion, "p_archivo": nombre, "p_sha256": lec.sha256, "p_modo": modo,
        "p_resumen": lec.resumen, "p_validaciones": lec.validaciones})
    try:
        filas = lec.presupuestos + lec.movimientos
        for i in range(0, len(filas), LOTE):
            await sb.rpc("importacion_cargar", {"p_id": imp_id, "p_filas": filas[i:i + LOTE]})
        previa = await sb.rpc("importacion_vista_previa", {"p_id": imp_id})
    except Exception:
        try:
            await sb.rpc("importacion_descartar", {"p_id": imp_id})
        except Exception:  # noqa: BLE001
            pass
        raise
    return {"importacion_id": imp_id, "gestion": lec.gestion, "archivo": nombre, "resumen": lec.resumen,
            "validaciones": lec.validaciones, "vista_previa": previa}

@app.post("/importaciones/automatico")
async def importar_automatico(
    archivo: UploadFile = File(...),
    gestion: int | None = Form(None),
    modo: Literal["sincronizar", "agregar"] = Form("sincronizar"),
    forzar_con_errores: bool = Form(False),
    sb=Depends(cliente),
):
    """Carga, valida y aplica automáticamente en la base de datos (exclusivo Admin)."""
    if not await sb.rpc("es_admin", {}):
        raise HTTPException(403, "Solo un administrador puede ejecutar la carga automática")
    nombre = archivo.filename or "archivo.xlsx"
    if not nombre.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(415, "Sube el archivo en formato .xlsx")
    contenido = await archivo.read(MAX_MB * 1024 * 1024 + 1)
    if len(contenido) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"El archivo pasa de {MAX_MB} MB")
    try:
        lec = await run_in_threadpool(leer_excel, contenido, nombre, gestion)
    except ErrorLectura as e:
        raise HTTPException(422, str(e)) from e

    errores = [v for v in lec.validaciones if v.get("severidad") == "error"]
    if errores and not forzar_con_errores:
        raise HTTPException(422, detail={
            "mensaje": "El archivo contiene errores de validación. Activa 'forzar con errores' o usa Importar Excel.",
            "validaciones": errores,
        })

    imp_id = await sb.rpc("importacion_iniciar", {
        "p_gestion": lec.gestion, "p_archivo": nombre, "p_sha256": lec.sha256, "p_modo": modo,
        "p_resumen": lec.resumen, "p_validaciones": lec.validaciones})
    try:
        filas = lec.presupuestos + lec.movimientos
        for i in range(0, len(filas), LOTE):
            await sb.rpc("importacion_cargar", {"p_id": imp_id, "p_filas": filas[i:i + LOTE]})
        resultado = await sb.rpc("importacion_confirmar", {"p_id": imp_id})
    except Exception:
        try:
            await sb.rpc("importacion_descartar", {"p_id": imp_id})
        except Exception:  # noqa: BLE001
            pass
        raise
    return {
        "importacion_id": imp_id,
        "gestion": lec.gestion,
        "archivo": nombre,
        "automatico": True,
        "resumen": lec.resumen,
        "validaciones": lec.validaciones,
        "resultado": resultado,
    }

@app.post("/importaciones/automatico")
async def importar_automatico(
    archivo: UploadFile = File(...),
    gestion: int | None = Form(None),
    modo: Literal["sincronizar", "agregar"] = Form("sincronizar"),
    forzar_con_errores: bool = Form(False),
    sb=Depends(cliente),
):
    """Carga, valida y aplica automáticamente en la base de datos (exclusivo Admin)."""
    if not await sb.rpc("es_admin", {}):
        raise HTTPException(403, "Solo un administrador puede ejecutar la carga automática")
    nombre = archivo.filename or "archivo.xlsx"
    if not nombre.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(415, "Sube el archivo en formato .xlsx")
    contenido = await archivo.read(MAX_MB * 1024 * 1024 + 1)
    if len(contenido) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"El archivo pasa de {MAX_MB} MB")
    try:
        lec = await run_in_threadpool(leer_excel, contenido, nombre, gestion)
    except ErrorLectura as e:
        raise HTTPException(422, str(e)) from e

    errores = [v for v in lec.validaciones if v.get("severidad") == "error"]
    if errores and not forzar_con_errores:
        raise HTTPException(422, detail={
            "mensaje": "El archivo contiene errores de validación. Activa 'forzar con errores' o usa Importar Excel.",
            "validaciones": errores,
        })

    imp_id = await sb.rpc("importacion_iniciar", {
        "p_gestion": lec.gestion, "p_archivo": nombre, "p_sha256": lec.sha256, "p_modo": modo,
        "p_resumen": lec.resumen, "p_validaciones": lec.validaciones})
    try:
        filas = lec.presupuestos + lec.movimientos
        for i in range(0, len(filas), LOTE):
            await sb.rpc("importacion_cargar", {"p_id": imp_id, "p_filas": filas[i:i + LOTE]})
        resultado = await sb.rpc("importacion_confirmar", {"p_id": imp_id})
    except Exception:
        try:
            await sb.rpc("importacion_descartar", {"p_id": imp_id})
        except Exception:  # noqa: BLE001
            pass
        raise
    return {
        "importacion_id": imp_id,
        "gestion": lec.gestion,
        "archivo": nombre,
        "automatico": True,
        "resumen": lec.resumen,
        "validaciones": lec.validaciones,
        "resultado": resultado,
    }


@app.post("/importaciones/{imp_id}/confirmar")
async def confirmar(imp_id: int, sb=Depends(cliente)):
    return await sb.rpc("importacion_confirmar", {"p_id": imp_id})


@app.post("/importaciones/{imp_id}/descartar")
async def descartar(imp_id: int, sb=Depends(cliente)):
    await sb.rpc("importacion_descartar", {"p_id": imp_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Exportación
# ---------------------------------------------------------------------------
class PedidoExportar(BaseModel):
    reporte: str | None = Field(None, description="Clave de /reportes; si no, usa titulo + dimensiones")
    titulo: str | None = None
    dimensiones: list[str] | None = None
    filtros: dict = Field(default_factory=dict)
    moneda: Literal["BS", "USD"] = "BS"
    criterio: Literal["real", "excel"] = "real"
    formato: Literal["xlsx", "pdf"] = "xlsx"


@app.post("/exportar")
async def exportar(p: PedidoExportar, sb=Depends(cliente)):
    preset = REPORTES.get(p.reporte or "", {})
    if p.reporte and not preset:
        raise HTTPException(404, f"No existe el reporte «{p.reporte}». Mira GET /reportes")
    titulo = p.titulo or preset.get("titulo") or "Reporte de ejecución presupuestaria"
    filtros_txt = describir_filtros(p.filtros, p.moneda)

    if p.reporte == "movimientos":
        filas: list = []
        while len(filas) < 50000:      # Supabase entrega como máximo 1.000 filas por llamada
            pagina = await sb.rpc("detalle_movimientos", {"p_filtros": p.filtros, "p_limite": 1000, "p_desplazamiento": len(filas)})
            filas += pagina
            if len(pagina) < 1000:
                break
        hacer = movimientos_xlsx if p.formato == "xlsx" else movimientos_pdf
        contenido = await run_in_threadpool(hacer, titulo, filas, filtros_txt, ORGANIZACION)
        return Response(contenido, media_type=TIPOS[p.formato], headers=_archivo(titulo, p.formato))

    kpis = None
    if p.reporte == "resumen":
        res = await sb.rpc("resumen_general", {"p_filtros": p.filtros, "p_moneda": p.moneda})
        mon = "USD" if p.moneda == "USD" else "Bs"
        kpis = [("Presupuesto vigente", f"{mon} {fmt_num(res.get('presupuesto_vigente'))}"),
                ("Ejecutado", f"{mon} {fmt_num(res.get('ejecutado'))}"),
                ("Saldo", f"{mon} {fmt_num(res.get('saldo'))}"),
                ("Ejecución", fmt_pct(res.get("pct_ejecucion"))),
                ("Avance del año", f"{fmt_pct(res.get('avance_tiempo'))} · {res.get('ultimo_mes') or 0}/12"),
                ("Cuentas en alerta", str(res.get("alertas") or 0))]
        secciones_def = [("Por financiador", ["financiador", "rubro"]), ("Por rubro", ["rubro"]),
                         ("Por región", ["region"]), ("Por mes", ["mes"])]
    else:
        dims = p.dimensiones if p.dimensiones is not None else preset.get("dimensiones") or []
        secciones_def = [(titulo, dims)]

    secciones = []
    for nombre_sec, dims in secciones_def:
        filas = await sb.rpc("reporte_json", {"p_dimensiones": dims, "p_filtros": p.filtros, "p_moneda": p.moneda})
        secciones.append({"titulo": nombre_sec, "dimensiones": dims, "filas": filas})
    hacer = reporte_xlsx if p.formato == "xlsx" else reporte_pdf
    contenido = await run_in_threadpool(hacer, titulo, secciones, filtros_txt, p.criterio, kpis, ORGANIZACION)
    return Response(contenido, media_type=TIPOS[p.formato], headers=_archivo(titulo, p.formato))


# ---------------------------------------------------------------------------
# La web compilada (opcional): queda en la misma dirección que la API
# ---------------------------------------------------------------------------
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
