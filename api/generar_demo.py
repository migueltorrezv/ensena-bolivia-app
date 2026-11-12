"""Genera web/public/demo.json, los datos del modo demo, a partir del Excel del sistema contable.

    python generar_demo.py Prueba_ExB.xlsx [ruta/de/salida/demo.json]

Ojo: demo.json queda dentro de la web pública. Úsalo solo con datos de prueba.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from lector import leer_excel


def generar(xlsx: Path) -> dict:
    lec = leer_excel(xlsx.read_bytes(), xlsx.name)
    g = lec.gestion
    rubros, cuentas, regiones, financiadores, areas = {}, {}, {}, set(), set()
    for f in lec.presupuestos + lec.movimientos:
        d = f["datos"]
        rubros.setdefault(d["rubro"], {"codigo": d["rubro"], "nombre": d["rubro_nombre"],
                                       "etiqueta": d["rubro_etiqueta"], "orden": d["rubro_orden"]})
        if d["cuenta"]:
            cuentas.setdefault(d["cuenta"], {"codigo": d["cuenta"], "nombre": d["cuenta_nombre"],
                                             "etiqueta": d["cuenta_etiqueta"], "orden": d["cuenta_orden"],
                                             "rubro_codigo": d["cuenta_rubro"]})
        regiones.setdefault(d["region"], d["region_nombre"])
        financiadores.add(d["financiador"])
        areas.add(d["area"])

    presupuestos = [[g, d["mes"], d["financiador"], d["region"], d["area"], d["rubro"], d["cuenta"], d["monto_bs"]]
                    for d in (f["datos"] for f in lec.presupuestos)]
    movimientos = [[i, g, d["mes"], d["fecha"], d["tipo"], d["numero"], d["no_cheque"], d["financiador"], d["region"],
                    d["area"], d["rubro"], d["cuenta"], d["cuenta_contable"], d["nombre_contable"], d["ref"],
                    d["debe_bs"], d["haber_bs"], d["debe_usd"], d["haber_usd"], d["tasa"]]
                   for i, d in enumerate((f["datos"] for f in lec.movimientos), start=1)]

    def conteo(filas, monto):
        return {"en_archivo": len(filas), "nuevos": len(filas), "nuevos_bs": round(monto, 2), "sin_cambio": 0,
                "a_eliminar": 0, "a_eliminar_bs": 0}

    pres_bs = sum(f["datos"]["monto_bs"] for f in lec.presupuestos)
    mov_bs = sum(f["datos"]["monto_bs"] for f in lec.movimientos)
    resultado = {"presupuesto": conteo(lec.presupuestos, pres_bs), "movimiento": conteo(lec.movimientos, mov_bs),
                 "modo": "sincronizar", "gestion": g}
    # Lo que vería quien vuelve a subir el mismo archivo: nada nuevo, nada que borrar
    otra_vez = {k: ({"en_archivo": v["en_archivo"], "nuevos": 0, "nuevos_bs": 0, "sin_cambio": v["en_archivo"],
                     "a_eliminar": 0, "a_eliminar_bs": 0} if isinstance(v, dict) else v) for k, v in resultado.items()}

    return {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "catalogos": {
            "gestiones": [{"anio": g, "estado": "abierta", "tasa_presupuesto": 6.96, "nota": None}],
            "financiadores": sorted(financiadores),
            "regiones": [{"codigo": k, "nombre": v} for k, v in sorted(regiones.items())],
            "areas": sorted(areas),
            "rubros": list(rubros.values()),
            "cuentas": list(cuentas.values()),
        },
        "presupuestos": presupuestos,
        "movimientos": movimientos,
        "importacion": {
            "archivo": xlsx.name, "gestion": g, "resumen": lec.resumen,
            "validaciones": [{**v, "id": i} for i, v in enumerate(lec.validaciones, start=1)],
            "resultado": resultado, "vista_previa": otra_vez,
        },
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Uso: python generar_demo.py archivo.xlsx [salida.json]")
    origen = Path(sys.argv[1])
    destino = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "web" / "public" / "demo.json"
    datos = generar(origen)
    destino.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"✓ {destino} · {len(datos['presupuestos'])} presupuestos, {len(datos['movimientos'])} movimientos, "
          f"{destino.stat().st_size / 1024:.0f} KB")
