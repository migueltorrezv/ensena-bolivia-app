"""Inicio de sesión del modo Postgres propio: contraseñas con scrypt y tokens JWT.
(En modo Supabase esto lo hace Supabase Auth y este archivo no se usa.)"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time

import jwt
from fastapi import HTTPException

log = logging.getLogger("autenticacion")

SECRETO = os.environ.get("JWT_SECRETO", "")
if not SECRETO:
    SECRETO = secrets.token_urlsafe(48)
    log.warning("Falta JWT_SECRETO: uso uno temporal (las sesiones se cierran al reiniciar la API)")
DURACION_HORAS = int(os.environ.get("SESION_HORAS", "12"))


def hash_clave(clave: str) -> str:
    if len(clave or "") < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    sal = secrets.token_bytes(16)
    h = hashlib.scrypt(clave.encode(), salt=sal, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${base64.b64encode(sal).decode()}${base64.b64encode(h).decode()}"


def verificar_clave(clave: str, guardado: str) -> bool:
    try:
        _, sal, h = guardado.split("$")
        calc = hashlib.scrypt((clave or "").encode(), salt=base64.b64decode(sal), n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except (ValueError, TypeError):
        return False


def emitir_token(uid: str, email: str) -> str:
    ahora = int(time.time())
    return jwt.encode({"sub": uid, "email": email, "iat": ahora, "exp": ahora + DURACION_HORAS * 3600},
                      SECRETO, algorithm="HS256")


def leer_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRETO, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "La sesión expiró: vuelve a iniciar sesión") from None
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Sesión inválida: vuelve a iniciar sesión") from None
