"""Prueba de punta a punta contra un Postgres local que imita Supabase.

Importa el Excel real por la API (FastAPI TestClient), confirma, y verifica que la
función reporte() cuadre al centavo con las 6 tablas dinámicas del archivo, además de
reimportación, sincronización, permisos, filtros y exportes.

    docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
    pip install -r ../api/requirements.txt "psycopg[binary]"
    PG_DSN=postgresql://postgres:postgres@localhost:5432/postgres python probar_local.py Prueba_ExB.xlsx
"""
import io
import os
import sys
import uuid
from pathlib import Path
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

import openpyxl
import psycopg
from fastapi import Header, HTTPException
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent / "api"))
import main  # noqa: E402
from lector import separar_codigo  # noqa: E402

if len(sys.argv) < 2:
    sys.exit("Uso: python probar_local.py <archivo.xlsx>")
XLSX = sys.argv[1]
SALIDAS = AQUI / "salidas"
SALIDAS.mkdir(exist_ok=True)
DSN_ADMIN = os.environ.get("PG_DSN", "postgresql://postgres:postgres@localhost:5432/postgres")
BASE = "prueba_presupuesto"
with psycopg.connect(DSN_ADMIN, autocommit=True) as c0:
    c0.execute(f"drop database if exists {BASE} with (force)")
    c0.execute(f"create database {BASE}")
DSN = psycopg.conninfo.make_conninfo(DSN_ADMIN, dbname=BASE)
USUARIOS = {"admin": str(uuid.uuid4()), "tecnico": str(uuid.uuid4()), "lector": str(uuid.uuid4())}

con = psycopg.connect(DSN, autocommit=True)
con.execute((AQUI / "simular_supabase.sql").read_text())
con.execute((AQUI.parent / "db" / "esquema.sql").read_text())
for rol, uid in USUARIOS.items():
    con.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"{rol}@exb.test"))
    con.execute("update public.perfiles set rol = %s where user_id = %s", (rol, uid))


def a_json(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, list):
        return [a_json(x) for x in v]
    if isinstance(v, dict):
        return {k: a_json(x) for k, x in v.items()}
    return v


class ClientePG:
    """Hace lo mismo que PostgREST: llama la función con el rol authenticated y el usuario del token."""
    def __init__(self, uid):
        self.uid = uid

    def rpc_sync(self, fn, params):
        info = con.execute("""select p.proargnames, p.proargtypes::regtype[]::text[] as tipos, p.proretset, p.pronargs,
                                     p.prorettype::regtype::text as ret
                              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'public' and p.proname = %s""", (fn,)).fetchone()
        if not info:
            raise HTTPException(404, f"no existe {fn}")
        nombres, tipos, es_set, nargs, ret = info
        args, vals = [], []
        for nombre, tipo in zip((nombres or [])[:nargs], tipos):
            if nombre in params:
                v = params[nombre]
                args.append(f"{nombre} => %s::{tipo}")
                vals.append(Jsonb(v) if tipo == "jsonb" else v)
        llamada = f"public.{fn}({', '.join(args)})"
        sql = f"select * from {llamada}" if es_set else f"select {llamada} as r"
        with psycopg.connect(DSN) as c:
            try:
                with c.transaction():
                    c.execute("set local role authenticated")
                    c.execute("select set_config('request.jwt.claim.sub', %s, true)", (self.uid,))
                    cur = c.cursor(row_factory=dict_row)
                    cur.execute(sql, vals)
                    filas = cur.fetchall()
            except psycopg.Error as e:
                raise HTTPException(403 if e.sqlstate == "42501" else 400, e.diag.message_primary) from None
        if es_set:
            return a_json(filas[:1000])      # Supabase corta en 1.000 filas (max_rows)
        return None if ret == "void" else a_json(filas[0]["r"])

    async def rpc(self, fn, params):
        return self.rpc_sync(fn, params)


def cliente_prueba(authorization: str | None = Header(None)):
    return ClientePG(USUARIOS[authorization.split()[1]])


main.app.dependency_overrides[main.cliente] = cliente_prueba
api = TestClient(main.app)
H = {r: {"Authorization": f"Bearer {r}"} for r in USUARIOS}
ok_count = 0


def ok(cond, msg):
    global ok_count
    if not cond:
        print("FALLA:", msg)
        sys.exit(1)
    ok_count += 1
    print("  ✓", msg)


def subir(contenido, quien="tecnico", **form):
    return api.post("/importaciones", headers=H[quien],
                    files={"archivo": ("Prueba_ExB_Nov_2026.xlsx", contenido,
                                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                    data={k: str(v) for k, v in form.items()})


original = open(XLSX, "rb").read()

print("1. Importación inicial (técnico)")
r = subir(original)
ok(r.status_code == 200, f"POST /importaciones → {r.status_code} {r.text[:200]}")
j = r.json()
codigos = [v["codigo"] for v in j["validaciones"]]
print("   validaciones:", codigos)
ok("PRESUPUESTO_DUPLICA_EJECUCION" in codigos and "RUBRO_SIN_EJECUCION" in codigos and "CODIGOS_EN_OTRA_HOJA" in codigos,
   "detecta las trampas del Excel")
vp = j["vista_previa"]
ok(vp["presupuesto"]["nuevos"] == 2096 and vp["movimiento"]["nuevos"] == 1478, f"vista previa: todo nuevo {vp}")
imp1 = j["importacion_id"]
ok(con.execute("select count(*) from public.movimientos").fetchone()[0] == 0, "el borrador no toca los datos")
r = api.post(f"/importaciones/{imp1}/confirmar", headers=H["tecnico"])
ok(r.status_code == 200, f"confirmar → {r.status_code} {r.text[:200]}")
n_p, n_m = con.execute("select (select count(*) from presupuestos), (select count(*) from movimientos)").fetchone()
ok((n_p, n_m) == (2096, 1478), f"quedaron {n_p} presupuestos y {n_m} movimientos (incluye las 643 filas idénticas)")
ok(con.execute("select count(*) from validaciones where importacion_id = %s", (imp1,)).fetchone()[0] == len(codigos),
   "validaciones guardadas en la base")
ok(con.execute("select count(*) from auditoria where tabla in ('presupuestos','movimientos','financiadores','areas','rubros','cuentas')").fetchone()[0] == 0,
   "la importación no llena la auditoría fila por fila")

print("2. Cuadre contra las 6 tablas dinámicas del Excel")
lector_pg = ClientePG(USUARIOS["lector"])
wb = openpyxl.load_workbook(XLSX)
MES_NUM = {"ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6, "JULIO": 7, "AGOSTO": 8, "SEPTIEMBRE": 9}
CAMPO_DIM = {"rubro": "rubro", "fondo": "financiador", "Cuenta": "cuenta", "area": "area", "region": "region", "mes": "mes"}


def llave_excel(campo, valor):
    v = str(valor).strip()
    if campo in ("rubro", "Cuenta"):
        return separar_codigo(v)[0]
    if campo == "mes":
        return str(MES_NUM.get(v, 0))
    return v


for ws in wb.worksheets:
    for pv in ws._pivots:
        nombres = [cf.name for cf in pv.cache.cacheFields]
        campos = [nombres[f.x] for f in pv.rowFields]
        dims = [CAMPO_DIM[c] for c in campos]
        rango = ws[pv.location.ref]
        esperado = defaultdict(lambda: [0.0, 0.0])
        camino = []
        for fila in rango[1:]:                         # sin el encabezado
            etq, pres, eje = fila[0].value, fila[1].value, fila[2].value
            if etq is None:
                continue
            if str(etq).strip() == "Total general":
                k = ()
            else:
                nivel = int(fila[0].alignment.indent or 0)
                camino = camino[:nivel] + [llave_excel(campos[nivel], etq)]
                k = tuple(camino)
            esperado[k][0] += float(pres or 0)
            esperado[k][1] += float(eje or 0)
        # Excel muestra '9.2 ' y '9.2 Expensas' por separado: los sumamos en la misma llave
        obtenido = {}
        for f in lector_pg.rpc_sync("reporte", {"p_dimensiones": dims, "p_filtros": {}}):
            k = tuple(f[f"k{i}"] for i in range(1, f["nivel"] + 1))
            obtenido[k] = (f["presupuesto_excel"], f["ejecutado"])
        malas = [(k, v, obtenido.get(k)) for k, v in esperado.items()
                 if k not in obtenido or abs(v[0] - obtenido[k][0]) > 0.005 or abs(v[1] - (obtenido[k][1] or 0)) > 0.005]
        extra = set(obtenido) - set(esperado)
        ok(not malas and not extra,
           f"«{ws.title}» ({' › '.join(dims)}): {len(esperado)} filas cuadran al centavo"
           + (f" | MALAS {malas[:3]} EXTRA {list(extra)[:3]}" if malas or extra else ""))

tot = lector_pg.rpc_sync("reporte", {"p_dimensiones": [], "p_filtros": {}})[0]
ok(abs(tot["presupuesto_excel"] - 3163379.01) < 0.005 and abs(tot["ejecutado"] - 528694.16) < 0.005
   and tot["pct_excel"] == 0.1671 and tot["pct_ejecucion"] == 0.2007,
   f"total: Excel {tot['presupuesto_excel']} / {tot['pct_excel']} · real {tot['presupuesto']} / {tot['pct_ejecucion']}")

print("3. Reimportar el mismo archivo no duplica nada")
r = subir(original)
vp = r.json()["vista_previa"]
ok(vp["presupuesto"]["nuevos"] == 0 and vp["movimiento"]["nuevos"] == 0 and vp["movimiento"]["a_eliminar"] == 0
   and vp["movimiento"]["sin_cambio"] == 1478, f"vista previa: 0 nuevos, 0 a eliminar, 1478 sin cambio")
api.post(f"/importaciones/{r.json()['importacion_id']}/confirmar", headers=H["tecnico"])
ok(con.execute("select count(*) from movimientos").fetchone()[0] == 1478, "siguen 1478 movimientos")

print("4. Sincronizar: el sistema contable corrigió un monto y borró 5 movimientos")
wb2 = openpyxl.load_workbook(io.BytesIO(original))
bd = wb2["BD"]
ult = bd.max_row
for fila in range(ult - 9, ult - 4):            # borra 5 movimientos de septiembre
    for c in range(1, 20):
        bd.cell(fila, c).value = None
fila_mod = ult - 16
monto_viejo = bd.cell(fila_mod, 10).value
bd.cell(fila_mod, 10).value = monto_viejo + 1000
bd.cell(fila_mod, 19).value = monto_viejo + 1000
buf = io.BytesIO()
wb2.save(buf)
r = subir(buf.getvalue())
vp = r.json()["vista_previa"]["movimiento"]
ok(vp["nuevos"] == 1 and vp["a_eliminar"] == 6, f"vista previa movimientos: {vp}")
api.post(f"/importaciones/{r.json()['importacion_id']}/confirmar", headers=H["tecnico"])
tot2 = lector_pg.rpc_sync("reporte", {"p_dimensiones": [], "p_filtros": {}})[0]
ok(abs(tot2["ejecutado"] - (528694.16 + 1000 - vp["a_eliminar_bs"] + monto_viejo)) < 0.01,
   f"ejecutado pasó a {tot2['ejecutado']}")
r = subir(original)
api.post(f"/importaciones/{r.json()['importacion_id']}/confirmar", headers=H["tecnico"])
tot3 = lector_pg.rpc_sync("reporte", {"p_dimensiones": [], "p_filtros": {}})[0]
ok(abs(tot3["ejecutado"] - 528694.16) < 0.005, "reimportar el original lo deja como estaba")

print("5. Permisos")
r = subir(original, quien="lector")
ok(r.status_code == 403, f"lector no puede importar → {r.status_code}")
try:
    with psycopg.connect(DSN) as c, c.transaction():
        c.execute("set local role authenticated")
        c.execute("select set_config('request.jwt.claim.sub', %s, true)", (USUARIOS["lector"],))
        c.execute("insert into public.modificaciones (gestion, financiador, region, area, rubro, cuenta, monto_bs, motivo) "
                  "values (2026, 'CEL 2026', 'LP', 'PROGRAMA', '5', '5.2', 5000, 'x')")
    ok(False, "lector insertó una modificación")
except psycopg.Error as e:
    ok("row-level security" in str(e), "lector no puede registrar modificaciones (RLS)")
with psycopg.connect(DSN) as c, c.transaction():
    c.execute("set local role authenticated")
    c.execute("select set_config('request.jwt.claim.sub', %s, true)", (USUARIOS["tecnico"],))
    c.execute("insert into public.modificaciones (gestion, financiador, region, area, rubro, cuenta, monto_bs, motivo) "
              "values (2026, 'CEL 2026', 'LP', 'PROGRAMA', '5', '5.2', 5000, 'Reformulación aprobada')")
ok(True, "técnico registra una modificación de +5.000")
tot4 = lector_pg.rpc_sync("reporte", {"p_dimensiones": [], "p_filtros": {}})[0]
ok(abs(tot4["presupuesto_vigente"] - (tot4["presupuesto"] + 5000)) < 0.005 and tot4["presupuesto_excel"] == tot["presupuesto_excel"],
   "la modificación sube el vigente y no altera el criterio Excel")
aud = con.execute("select tabla, operacion, email from auditoria where tabla = 'modificaciones'").fetchall()
ok(aud == [("modificaciones", "INSERT", "tecnico@exb.test")], f"auditoría: {aud}")
ok(ClientePG(USUARIOS["lector"]).rpc_sync("rol_actual", {}) == "lector", "rol_actual() responde")
with psycopg.connect(DSN) as c, c.transaction():
    c.execute("set local role authenticated")
    c.execute("select set_config('request.jwt.claim.sub', %s, true)", (USUARIOS["lector"],))
    vistos = c.execute("select count(*) from public.auditoria").fetchone()[0]
ok(vistos == 0, "lector no ve la auditoría")
try:
    with psycopg.connect(DSN) as c, c.transaction():
        c.execute("set local role anon")
        c.execute("select * from public.reporte('{rubro}')")
    ok(False, "anon pudo llamar reporte()")
except psycopg.Error:
    ok(True, "sin sesión no se puede llamar reporte()")
try:
    lector_pg.rpc_sync("reporte", {"p_dimensiones": ["rubro; drop table movimientos"], "p_filtros": {}})
    ok(False, "aceptó una dimensión inventada")
except HTTPException as e:
    ok("Dimensión no permitida" in e.detail, "dimensiones fuera de la lista blanca se rechazan")

print("6. Filtros, detalle, alertas, resumen, USD y comparativo")
f = lector_pg.rpc_sync("reporte", {"p_dimensiones": ["rubro"], "p_filtros": {"financiadores": ["CATALYST 18"], "regiones": ["LP"], "mes_hasta": 6}})
ok(f[-1]["d1"] == "Total general" and f[-1]["nivel"] == 0, "el total va al final")
esp = con.execute("select sum(ejecutado_bs) from movimientos where financiador='CATALYST 18' and region='LP' and mes<=6").fetchone()[0]
ok(abs(f[-1]["ejecutado"] - float(esp)) < 0.005, f"filtros combinados: ejecutado {f[-1]['ejecutado']} = {esp}")
d = lector_pg.rpc_sync("detalle_movimientos", {"p_filtros": {"texto": "alquiler"}, "p_limite": 5})
ok(len(d) == 5 and d[0]["total"] > 5, f"detalle con búsqueda y paginado: 5 de {d[0]['total']}")
al = lector_pg.rpc_sync("alertas_ejecucion", {"p_filtros": {}})
print("   alertas:", [(a["financiador"], a["cuenta_etiqueta"], a["pct_ejecucion"], a["alerta"]) for a in al])
ok(len(al) >= 1, f"{len(al)} alertas de ejecución")
res = lector_pg.rpc_sync("resumen_general", {"p_filtros": {}})
ok(res["ultimo_mes"] == 9 and len(res["por_mes"]) == 9 and res["ultima_importacion"]["archivo"], f"resumen: avance {res['avance_tiempo']}, ritmo {res['ritmo']}")
usd = lector_pg.rpc_sync("reporte", {"p_dimensiones": [], "p_filtros": {}, "p_moneda": "USD"})[0]
esp_usd = con.execute("select sum(ejecutado_usd) from movimientos").fetchone()[0]
ok(abs(usd["ejecutado"] - float(esp_usd)) < 0.005, f"USD: ejecutado {usd['ejecutado']}")
r = subir(original, gestion=2025)
ok(r.status_code == 200 and "FECHAS_FUERA_DE_GESTION" in [v["codigo"] for v in r.json()["validaciones"]],
   "importar en otra gestión avisa fechas fuera de gestión")
api.post(f"/importaciones/{r.json()['importacion_id']}/confirmar", headers=H["tecnico"])
comp = lector_pg.rpc_sync("reporte", {"p_dimensiones": ["rubro", "gestion"], "p_filtros": {"gestiones": [2025, 2026]}})
ok(len([x for x in comp if x["nivel"] == 2]) == 12, "comparativo 2025 vs 2026 por rubro")
por_defecto = lector_pg.rpc_sync("reporte", {"p_dimensiones": [], "p_filtros": {}})[0]
ok(abs(por_defecto["ejecutado"] - 528694.16) < 0.005, "sin filtro de gestión se usa la más reciente")

print("7. Exportes")
for clave in ["rubro-cuenta", "financiador", "area-financiador", "region", "mes", "movimientos", "resumen", "comparativo"]:
    for fmt in ("xlsx", "pdf"):
        filtros = {"gestiones": [2025, 2026]} if clave == "comparativo" else {}
        r = api.post("/exportar", headers=H["lector"], json={"reporte": clave, "formato": fmt, "filtros": filtros})
        ok(r.status_code == 200 and len(r.content) > 2000, f"{clave}.{fmt}: {len(r.content):,} bytes")
        with open(SALIDAS / f"{clave}.{fmt}", "wb") as fh:
            fh.write(r.content)
r = api.post("/exportar", headers=H["lector"], json={"reporte": "region", "formato": "xlsx", "criterio": "excel"})
wbx = openpyxl.load_workbook(io.BytesIO(r.content))
ws = wbx.active
niveles = {ws.row_dimensions[i].outline_level for i in range(1, ws.max_row + 1)}
ok(niveles >= {0, 1, 2, 3, 4}, f"el Excel exportado trae niveles plegables {sorted(niveles)}")
wbm = openpyxl.load_workbook(SALIDAS / "movimientos.xlsx")
n_mov = sum(1 for row in wbm.active.iter_rows(min_row=4, values_only=True) if isinstance(row[0], datetime))
ok(n_mov == 1478, f"el export de movimientos trae los 1478 (pagina de a 1.000): {n_mov}")
rj = lector_pg.rpc_sync("reporte_json", {"p_dimensiones": ["region", "area", "financiador", "rubro", "cuenta"], "p_filtros": {}})
rt = con.execute("select k1,k2,k3,k4,k5 from public.reporte('{region,area,financiador,rubro,cuenta}')").fetchall()
ok([tuple(x[f"k{i}"] for i in range(1, 6)) for x in rj] == [tuple(x) for x in rt], f"reporte_json mantiene el orden ({len(rj)} filas)")
print(f"\nTODO OK · {ok_count} comprobaciones")
