"""Crea o actualiza la base en un PostgreSQL propio (modo postgres), sin necesitar psql.

    DATABASE_URL=postgresql://usuario:clave@host:5432/base python iniciar_db.py

Corre db/postgres_propio.sql y luego db/esquema.sql. Se puede repetir sin perder datos.
No lo uses con Supabase: ahí pega db/esquema.sql en el SQL Editor.
"""
import os
import sys
from pathlib import Path

import psycopg

url = os.environ.get("DATABASE_URL") or (sys.argv[1] if len(sys.argv) > 1 else "")
if not url:
    sys.exit("Falta DATABASE_URL")
url = url.replace("postgresql+psycopg://", "postgresql://").replace("postgres://", "postgresql://", 1)
DB = Path(__file__).resolve().parent.parent / "db"
with psycopg.connect(url, autocommit=True) as c:
    for nombre in ("postgres_propio.sql", "esquema.sql"):
        c.execute((DB / nombre).read_text(encoding="utf-8"))
        print(f"✓ {nombre}")
print("Base lista. Arranca la API con MODO=postgres y crea el admin con ADMIN_EMAIL y ADMIN_CLAVE.")
