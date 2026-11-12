"""Acceso a datos con dos motores intercambiables. Los dos llaman a las mismas
funciones SQL de db/esquema.sql, así que la web y los reportes son idénticos.

- Supabase: la API REST de Supabase (PostgREST) con el token del usuario.
- MotorPostgres: PostgreSQL directo con SQLAlchemy. En cada consulta se identifica
  como el usuario (rol authenticated + request.jwt.claim.sub), igual que hace Supabase,
  así los permisos por fila y la auditoría funcionan igual.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import httpx
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError

log = logging.getLogger("datos")


def a_json(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, list):
        return [a_json(x) for x in v]
    if isinstance(v, dict):
        return {k: a_json(x) for k, x in v.items()}
    return v


# ---------------------------------------------------------------------------
# Supabase (PostgREST)
# ---------------------------------------------------------------------------
class Supabase:
    def __init__(self, url: str, key: str, token: str):
        self.url, self.key, self.token = url, key, token

    async def rpc(self, funcion: str, params: dict) -> Any:
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(f"{self.url}/rest/v1/rpc/{funcion}", json=params, headers={
                "apikey": self.key, "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        if r.status_code >= 400:
            try:
                err = r.json()
            except ValueError:
                err = {"message": r.text}
            codigo = str(err.get("code", ""))
            estado = 401 if r.status_code == 401 or codigo.startswith("PGRST30") else 403 if codigo == "42501" else 400
            raise HTTPException(estado, err.get("message") or err.get("msg") or "Error de Supabase")
        return r.json() if r.content else None


# ---------------------------------------------------------------------------
# PostgreSQL propio con SQLAlchemy
# ---------------------------------------------------------------------------
def normalizar_url(url: str) -> str:
    for prefijo in ("postgres://", "postgresql://"):
        if url.startswith(prefijo):
            return "postgresql+psycopg://" + url[len(prefijo):]
    return url


def traducir_error(e: DBAPIError) -> HTTPException:
    orig = getattr(e, "orig", None)
    estado = getattr(orig, "sqlstate", None) or ""
    diag = getattr(orig, "diag", None)
    msg = (getattr(diag, "message_primary", None) or str(orig or e)).strip()
    if estado == "42501":
        return HTTPException(403, msg)
    if isinstance(e, IntegrityError) or estado.startswith("23"):
        if estado == "23505":
            return HTTPException(409, "Ya existe un registro con esos datos")
        if estado == "23503":
            return HTTPException(400, "Alguno de los datos no existe en los catálogos")
        return HTTPException(400, f"Dato inválido: {msg}")
    if estado == "P0001" or estado.startswith("22") or estado.startswith("42"):
        return HTTPException(400, msg)
    log.error("Error de base de datos [%s]: %s", estado, msg)
    return HTTPException(500, "Error de base de datos")


class MotorPostgres:
    def __init__(self, url: str):
        self.engine = create_engine(normalizar_url(url), pool_pre_ping=True, pool_size=5, max_overflow=5)
        self._firmas: dict[str, tuple] = {}
        self._candado = threading.Lock()
        try:
            with self.engine.connect() as c:
                self.cambia_rol = bool(c.execute(text("select pg_has_role(current_user, 'authenticated', 'member')")).scalar())
        except DBAPIError:
            self.cambia_rol = False
        if not self.cambia_rol:
            log.warning("El usuario de la base no puede usar el rol 'authenticated': se protege con los chequeos de cada función")

    def _firma(self, c, fn: str) -> tuple:
        if fn not in self._firmas:
            filas = c.execute(text("""
                select p.proargnames, p.proargtypes::regtype[]::text[], p.proretset, p.pronargs, p.prorettype::regtype::text
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = :fn"""), {"fn": fn}).fetchall()
            if len(filas) != 1:
                raise HTTPException(404, f"No existe la función {fn}")
            nombres, tipos, es_set, nargs, ret = filas[0]
            with self._candado:
                self._firmas[fn] = (list(zip((nombres or [])[:nargs], tipos)), es_set, ret)
        return self._firmas[fn]

    def rpc(self, uid: str | None, fn: str, params: dict) -> Any:
        try:
            with self.engine.begin() as c:
                if self.cambia_rol:
                    c.execute(text("set local role authenticated"))
                c.execute(text("select set_config('request.jwt.claim.sub', :u, true)"), {"u": uid or ""})
                args, es_set, ret = self._firma(c, fn)
                validos = {n for n, _ in args}
                sobran = set(params) - validos
                if sobran:
                    raise HTTPException(400, f"Parámetros desconocidos para {fn}: {', '.join(sorted(sobran))}")
                partes, binds = [], {}
                for nombre, tipo in args:
                    if nombre in params:
                        v = params[nombre]
                        binds[nombre] = json.dumps(v) if tipo in ("jsonb", "json") and v is not None else v
                        partes.append(f"{nombre} => CAST(:{nombre} AS {tipo})")
                llamada = f"public.{fn}({', '.join(partes)})"
                if es_set:
                    filas = c.execute(text(f"select * from {llamada}"), binds).mappings().all()
                    return [a_json(dict(f)) for f in filas]
                valor = c.execute(text(f"select {llamada}"), binds).scalar()
                return None if ret == "void" else a_json(valor)
        except DBAPIError as e:
            raise traducir_error(e) from None

    # --- Usuarios (solo modo Postgres propio; en Supabase los maneja Supabase Auth) ---
    def buscar_credencial(self, email: str) -> tuple[str, str] | None:
        with self.engine.connect() as c:
            fila = c.execute(text("""select u.id::text, k.hash from auth.users u join auth.credenciales k on k.user_id = u.id
                                     where lower(u.email) = lower(:e)"""), {"e": email.strip()}).fetchone()
        return (fila[0], fila[1]) if fila else None

    def crear_usuario(self, email: str, hash_clave: str, rol: str, creado_por: str | None = None) -> str:
        if rol not in ("admin", "tecnico", "lector"):
            raise HTTPException(400, "Rol inválido (usa admin, tecnico o lector)")
        try:
            with self.engine.begin() as c:
                c.execute(text("select set_config('request.jwt.claim.sub', :u, true)"), {"u": creado_por or ""})
                uid = c.execute(text("insert into auth.users (email) values (lower(:e)) returning id::text"),
                                {"e": email.strip()}).scalar()
                c.execute(text("insert into auth.credenciales (user_id, hash) values (:u, :h)"), {"u": uid, "h": hash_clave})
                c.execute(text("insert into public.perfiles (user_id, email, rol) values (:u, lower(:e), :r) "
                               "on conflict (user_id) do update set rol = excluded.rol"), {"u": uid, "e": email.strip(), "r": rol})
                return uid
        except IntegrityError as e:
            if getattr(e.orig, "sqlstate", "") == "23505":
                raise HTTPException(409, "Ya existe un usuario con ese correo") from None
            raise traducir_error(e) from None

    def cambiar_clave(self, uid: str, hash_clave: str, cambiado_por: str | None = None) -> None:
        with self.engine.begin() as c:
            c.execute(text("select set_config('request.jwt.claim.sub', :u, true)"), {"u": cambiado_por or ""})
            n = c.execute(text("update auth.credenciales set hash = :h, actualizado = now() where user_id = cast(:u as uuid)"),
                          {"u": uid, "h": hash_clave}).rowcount
            if not n:
                raise HTTPException(404, "No existe el usuario")

    def existe_email(self, email: str) -> bool:
        with self.engine.connect() as c:
            return bool(c.execute(text("select 1 from auth.users where lower(email) = lower(:e)"), {"e": email.strip()}).scalar())


class DriverPostgres:
    """Lo que reciben las rutas: el motor compartido + el usuario de la petición."""
    def __init__(self, motor: MotorPostgres, uid: str):
        self.motor, self.uid = motor, uid

    async def rpc(self, funcion: str, params: dict) -> Any:
        return await run_in_threadpool(self.motor.rpc, self.uid, funcion, params)
