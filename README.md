# Control Presupuestario y Ejecución Financiera

Aplicativo web completo para el reto: importa el Excel del sistema contable, lo valida, acumula
gestiones y reproduce los 7 informes con despliegue de niveles, filtros combinados y descarga en
Excel y PDF, más un tablero.

**Una sola web, tres formas de correrla.** Se elige en `config.js` (o la API lo decide sola si sirve la web):

| Modo | Para qué | Base de datos y login | Importar / exportar |
|---|---|---|---|
| `demo` | Verla ya, sin instalar nada | Ninguna: `demo.json` con los datos del Excel de prueba | Análisis del archivo de prueba; descargas en CSV |
| `supabase` | Nuestra opción | Supabase (Postgres + Auth + tiempo real) | FastAPI |
| `api` | La opción de la foto | FastAPI + SQLAlchemy + PostgreSQL propio | FastAPI |

Los tres usan **las mismas funciones SQL** (`db/esquema.sql`), así que los reportes dan exactamente lo
mismo. El modo demo las replica en JavaScript y se comparó contra Postgres: 109 consultas idénticas.

```
web/   React + Vite + Tailwind + Recharts      (la interfaz)
api/   Python + FastAPI + SQLAlchemy + OpenPyXL + ReportLab   (Excel, PDF, login del modo api)
db/    PostgreSQL: tablas, roles, auditoría, importación y motor de reportes
pruebas/  pruebas de punta a punta (modo supabase simulado y modo api)
```

## Comparado con el stack de la foto

Coincide en todo lo importante: React + Vite, Tailwind, Recharts, FastAPI, OpenPyXL y PostgreSQL. Cambios:

- **SQLAlchemy** se usa como capa de conexión, no como modelos ORM. Los reportes con `GROUP BY ROLLUP` viven
  en Postgres para que los dos modos usen el mismo motor y los mismos permisos por fila.
- **Pandas no hace falta**: openpyxl lee el Excel celda por celda (fechas mezcladas, filas idénticas,
  encabezados corridos) y la API queda más liviana.
- **Se agregó lo que el reto pide y la tabla no tenía**: exportación a **PDF** (ReportLab) y **usuarios,
  roles, permisos y registro de auditoría**.

---

## A. Verla ya (modo demo)

`web/dist` ya viene compilada en modo demo. Arrastra la carpeta `web/dist` a <https://app.netlify.com/drop>
y entra con cualquiera de los tres usuarios de ejemplo (admin, técnico, lector).

> `demo.json` lleva los datos del Excel de prueba dentro de la página: úsalo solo con datos de prueba.

## B. Con Supabase (nuestra opción)

1. **Base:** en Supabase, SQL Editor → pega `db/esquema.sql` → Run.
2. **Usuarios:** Authentication → Add user (con *Auto Confirm*). Todos nacen como `lector`. Para el admin:
   ```sql
   update public.perfiles set rol = 'admin' where email = 'tu@correo.com';
   ```
3. **API** (Render, Railway…): carpeta `api`, build `pip install -r requirements.txt`,
   arranque `uvicorn main:app --host 0.0.0.0 --port $PORT`. Variables:
   `MODO=supabase`, `SUPABASE_URL`, `SUPABASE_KEY` (la **publishable** key), `ORIGENES` (URL de la web) y `ORGANIZACION`.
4. **Web:** edita `web/dist/config.js`:
   ```js
   window.CONFIG = { MODO: 'supabase', SUPABASE_URL: 'https://xxxx.supabase.co',
     SUPABASE_KEY: 'sb_publishable_...', API_URL: 'https://tu-api.onrender.com', ORGANIZACION: '...' }
   ```
   y súbela a Netlify. **Más fácil:** sube el proyecto entero al servidor de la API: ella misma sirve la web
   en su dirección y le pasa la configuración, sin tocar `config.js`.

La API nunca usa la secret key: reenvía el token del usuario a Supabase y los permisos los aplica la base.

## C. Con FastAPI + SQLAlchemy + PostgreSQL (la opción de la foto)

```bash
# 1. Un PostgreSQL con permiso para crear roles (Docker local, Neon, Railway…)
docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16

# 2. Crear la base (corre db/postgres_propio.sql y db/esquema.sql; se puede repetir)
cd api
pip install -r requirements.txt
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres python iniciar_db.py

# 3. Arrancar: crea el primer admin y sirve la web en la misma dirección
MODO=postgres DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
JWT_SECRETO=una-clave-larga-y-secreta ADMIN_EMAIL=admin@tu.org ADMIN_CLAVE=una-clave-segura \
uvicorn main:app --port 8000
```
Abre <http://localhost:8000>, entra con el admin y crea los demás usuarios en Administración.
En la nube es lo mismo: API en Render con esas variables y la base en Neon o Railway.

## Desarrollar la web

```bash
cd web
npm install
npm run dev          # http://localhost:5173 · usa public/config.js
npm run build        # genera dist/
```
Para el modo demo con otro Excel: `python api/generar_demo.py archivo.xlsx`.

---

## Qué tiene la web

| Sección | Qué hace |
|---|---|
| **Tablero** | Ritmo de ejecución contra el calendario, gasto acumulado y mensual, avance por financiador, rubro y región, alertas de cuentas al 80 %, sobregiradas o con gasto sin presupuesto. |
| **Reportes** | Los 7 informes del reto, el comparativo por gestiones y una consulta dinámica donde eliges las dimensiones. Árbol desplegable, gráfico, clic en una fila para ver sus movimientos, descarga en Excel (con niveles plegables) o PDF. |
| **Movimientos** | Detalle paginado con búsqueda en la glosa y los mismos filtros. |
| **Importar Excel** | Sube el archivo, muestra lo que no cuadra y qué cambiaría (nuevas, sin cambio, eliminadas) **antes** de aplicar. Historial de importaciones. |
| **Modificaciones** | Incrementos y reducciones del presupuesto con motivo y documento; los reportes muestran el vigente. |
| **Administración** | Usuarios y roles, cierre de gestiones y tasa del presupuesto, registro de auditoría. |

Arriba de todo: gestión, moneda (Bs o USD) y criterio de presupuesto (**real** o **como el Excel**).

| Rol | Puede |
|---|---|
| `admin` | Todo, incluidos usuarios, gestiones y auditoría. |
| `tecnico` | Importar y registrar modificaciones. |
| `lector` | Ver, filtrar y descargar. |

## Los 7 reportes

Todos salen de `reporte_json(p_dimensiones, p_filtros, p_moneda)`:

| Reporte | Dimensiones | Hoja del Excel |
|---|---|---|
| Por rubro y cuenta | `rubro, cuenta` | por cuenta |
| Por financiador | `financiador, rubro` | Financiador |
| Por área y financiador | `area, financiador, rubro` | Por Area y Fin |
| Por región | `region, area, financiador, rubro, cuenta` | Por region y Area |
| Por mes | `mes` | Por mes |
| Detalle de movimientos | `detalle_movimientos(...)` | Detalle |
| Resumen general consolidado | `resumen_general(...)` | Rubro |
| Comparativo por gestiones | `rubro, gestion` | — |

Con el criterio «como el Excel» las 6 dinámicas **cuadran al centavo** (517 filas). Filtros aceptados:
`gestiones, financiadores, regiones, areas, rubros, cuentas, cuentas_contables, meses, mes_desde, mes_hasta,
incluir_anual, texto`.

## Lo que la importación detecta en el Excel de prueba

| Validación | Qué avisa |
|---|---|
| Presupuesto duplica ejecución | Los movimientos repiten su monto en «presupuesto Bs»: las dinámicas dan 16,7 %; la ejecución real es 20,1 %. |
| Rubro sin ejecución | «9. Otros Gastos Ope.» tiene Bs 473.009,69 presupuestados y ningún gasto. |
| Códigos en otra hoja | Detalle2 usa el rubro «91.» y fondos que no existen en BD. |
| Gasto sin presupuesto | 4 combinaciones gastan Bs 6.344,04 sin presupuesto. |
| Cuenta fuera de rubro | 7 cuentas cargadas bajo un rubro que no es el suyo. |
| Tipo de cambio | 2 movimientos donde USD × tasa no da el monto en Bs. |
| Reporte por mes engañoso | «Por mes» muestra 72–94 % porque usa el gasto como presupuesto. La web muestra, en su lugar, el avance acumulado contra el presupuesto anual. |
| Informativas | Etiquetas unificadas, fechas en texto, 40 tasas de cambio, 643 filas idénticas, presupuesto mensualizado. |

Reimportar el mismo archivo no duplica nada; en modo `sincronizar` lo corregido o borrado en el sistema
contable se refleja. Confirmen con los jurados qué criterio de presupuesto quieren ver por defecto.

## Seguridad y auditoría

RLS en todas las tablas y chequeo de rol dentro de cada función (protege también cuando la API se conecta
como dueña). `auditoria` guarda quién cambió qué, cuándo, con antes y después; las importaciones quedan con
usuario, archivo, hash SHA-256, validaciones y resultado. Una gestión cerrada no acepta importaciones ni
modificaciones. Para las copias de seguridad, programen un `pg_dump` nocturno (por ejemplo con GitHub Actions).

## Pruebas

```bash
pip install -r api/requirements.txt "psycopg[binary]"
# Modo supabase simulado: cuadre con las 6 dinámicas, reimportación, sincronización, permisos y exportes
PG_DSN=postgresql://postgres:postgres@localhost:5432/postgres python pruebas/probar_local.py Prueba_ExB.xlsx
# Modo api contra una API corriendo: login, usuarios, importación, permisos, gestión cerrada y exportes
python pruebas/probar_api.py http://localhost:8000 Prueba_ExB.xlsx admin@tu.org una-clave-segura
```
La web se probó navegándola en Chrome en los tres modos (Supabase, simulado en local): login, cada pantalla, importar por la interfaz,
modificaciones, administración y descargas, sin errores de consola.
