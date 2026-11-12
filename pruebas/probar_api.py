"""Prueba el modo FastAPI + SQLAlchemy contra una API corriendo (modo postgres).

    python probar_api.py http://localhost:8000 Prueba_ExB.xlsx admin@correo clave-admin
"""
import sys

import httpx

BASE, XLSX, ADMIN, CLAVE = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3], sys.argv[4]
c = httpx.Client(base_url=BASE, timeout=120)
n = 0


def ok(cond, msg):
    global n
    if not cond:
        print("FALLA:", msg)
        sys.exit(1)
    n += 1
    print("  ✓", msg)


def entrar(email, clave):
    r = c.post("/auth/login", json={"email": email, "clave": clave})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def rpc(h, fn, **p):
    return c.post(f"/rpc/{fn}", headers=h, json=p)


print("1. Sesión y usuarios")
ok(c.post("/auth/login", json={"email": ADMIN, "clave": "mala"}).status_code == 401, "contraseña incorrecta → 401")
A = entrar(ADMIN, CLAVE)
ok(c.get("/auth/yo", headers=A).json()["rol"] == "admin", "el admin inicial existe")
for email, rol in (("tecnico@exb.test", "tecnico"), ("lector@exb.test", "lector")):
    r = c.post("/auth/usuarios", headers=A, json={"email": email, "clave": "clave-segura-1", "rol": rol})
    ok(r.status_code in (200, 409), f"crear {rol} → {r.status_code}")
T, L = entrar("tecnico@exb.test", "clave-segura-1"), entrar("lector@exb.test", "clave-segura-1")
ok(c.post("/auth/usuarios", headers=L, json={"email": "x@exb.test", "clave": "clave-segura-1"}).status_code == 403,
   "un lector no crea usuarios")
ok(c.get("/auth/yo").status_code == 401, "sin token → 401")
ok(rpc(A, "importacion_confirmar", p_id=1).status_code == 404, "/rpc solo expone las funciones de la web")

print("2. Importar y confirmar")
archivo = open(XLSX, "rb").read()
sube = lambda h: c.post("/importaciones", headers=h, files={"archivo": ("Prueba_ExB.xlsx", archivo)}, data={"modo": "sincronizar"})  # noqa: E731
ok(sube(L).status_code == 403, "un lector no importa")
r = sube(T)
ok(r.status_code == 200 and len(r.json()["validaciones"]) >= 10, f"técnico sube el Excel → {r.status_code}")
imp = r.json()["importacion_id"]
ok(c.post(f"/importaciones/{imp}/confirmar", headers=T).status_code == 200, "confirmar")
tot = rpc(L, "reporte_json", p_dimensiones=[], p_filtros={}).json()[0]
ok(abs(tot["ejecutado"] - 528694.16) < 0.005 and abs(tot["presupuesto_excel"] - 3163379.01) < 0.005, "los totales cuadran con el Excel")
r = sube(T)
ok(r.json()["vista_previa"]["movimiento"]["nuevos"] == 0, "reimportar: 0 nuevos")
c.post(f"/importaciones/{r.json()['importacion_id']}/descartar", headers=T)

print("3. Consultas de la web")
cat = rpc(L, "catalogos").json()
ok(cat["gestiones"][0]["anio"] == 2026 and len(cat["rubros"]) == 6 and len(cat["financiadores"]) == 3, "catálogos")
ok(len(rpc(L, "reporte_json", p_dimensiones=["region", "area", "financiador", "rubro", "cuenta"], p_filtros={}).json()) == 316,
   "reporte por región: 316 filas como la dinámica")
ok(rpc(L, "resumen_general", p_filtros={}).json()["ultimo_mes"] == 9, "resumen general")
ok(len(rpc(L, "alertas_ejecucion", p_filtros={}, p_umbral=0.8).json()) == 4, "alertas")
d = rpc(L, "detalle_movimientos", p_filtros={"texto": "alquiler"}, p_limite=5, p_desplazamiento=0).json()
ok(len(d) == 5 and d[0]["total"] == 19, "detalle con búsqueda")
imps = rpc(L, "listar_importaciones", p_limite=10).json()
ok(imps[0]["estado"] in ("aplicada", "descartada") and imps[-1]["usuario"], "historial de importaciones")
ok(len(rpc(L, "validaciones_de", p_importacion=imp).json()) >= 10, "validaciones guardadas")
ok(rpc(L, "reporte_json", p_dimensiones=["rubro; drop"], p_filtros={}).status_code == 400, "dimensión inventada → 400")

print("4. Modificaciones y permisos")
mod = {"gestion": 2026, "financiador": "CEL 2026", "region": "LP", "area": "PROGRAMA", "rubro": "5", "cuenta": "5.2",
       "monto_bs": 5000, "motivo": "Reformulación aprobada"}
ok(rpc(L, "registrar_modificacion", p=mod).status_code == 403, "un lector no registra modificaciones")
r = rpc(T, "registrar_modificacion", p=mod)
ok(r.status_code == 200, f"técnico registra +5.000 → {r.text[:80]}")
ok(rpc(T, "registrar_modificacion", p={**mod, "motivo": ""}).status_code == 400, "sin motivo → 400")
tot2 = rpc(L, "reporte_json", p_dimensiones=[], p_filtros={}).json()[0]
ok(abs(tot2["presupuesto_vigente"] - tot2["presupuesto"] - 5000) < 0.005, "el vigente sube 5.000")
ok(len(rpc(L, "listar_modificaciones", p_filtros={}).json()) == 1, "lista de modificaciones")
ok(rpc(T, "eliminar_modificacion", p_id=r.json()).status_code == 200, "eliminar modificación")
ok(rpc(L, "listar_usuarios").status_code == 403, "un lector no ve usuarios")
us = rpc(A, "listar_usuarios").json()
ok(len(us) == 3, "el admin ve los 3 usuarios")
admin_id = next(u["user_id"] for u in us if u["rol"] == "admin")
ok(rpc(A, "cambiar_rol", p_user_id=admin_id, p_rol="lector").status_code == 400, "no se puede quitar al único admin")
aud = rpc(A, "listar_auditoria", p_limite=50).json()
ok(any(a["tabla"] == "modificaciones" and a["operacion"] == "DELETE" and a["email"] == "tecnico@exb.test" for a in aud),
   "la auditoría registra quién borró la modificación")
ok(rpc(A, "actualizar_gestion", p_anio=2026, p_estado="cerrada").status_code == 200, "cerrar la gestión 2026")
ok(sube(T).status_code == 403, "gestión cerrada: ya no se importa")
ok(rpc(T, "registrar_modificacion", p=mod).status_code == 403, "gestión cerrada: ya no se modifica")
rpc(A, "actualizar_gestion", p_anio=2026, p_estado="abierta")
lector_id = next(u["user_id"] for u in us if u["rol"] == "lector")
ok(c.put(f"/auth/usuarios/{lector_id}/clave", headers=L, json={"clave": "otra-clave-22"}).status_code == 200, "el lector cambia su clave")
ok(c.post("/auth/login", json={"email": "lector@exb.test", "clave": "otra-clave-22"}).status_code == 200, "y entra con la nueva")
c.put(f"/auth/usuarios/{lector_id}/clave", headers=A, json={"clave": "clave-segura-1"})

print("5. Exportes")
for clave in ("rubro-cuenta", "movimientos", "resumen"):
    for fmt in ("xlsx", "pdf"):
        r = c.post("/exportar", headers=L, json={"reporte": clave, "formato": fmt})
        ok(r.status_code == 200 and len(r.content) > 2000, f"{clave}.{fmt} ({len(r.content):,} bytes)")
print(f"\nTODO OK · {n} comprobaciones")
