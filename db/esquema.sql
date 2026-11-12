-- =====================================================================
-- Control Presupuestario y Ejecución Financiera: esquema de Supabase
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO → Run.
-- Se puede volver a correr sin perder datos (es idempotente).
--
-- Ideas clave
--  * Presupuesto y ejecución viven en tablas separadas. El presupuesto
--    "real" son solo las filas de presupuesto; el reporte además devuelve
--    el criterio del Excel (presupuesto + ejecutado) para poder cuadrar.
--  * Cada fila importada tiene una clave (hash) calculada por el importador:
--    reimportar el mismo archivo no duplica nada, y en modo "sincronizar"
--    lo que desapareció del sistema contable se elimina.
--  * Un solo motor de reportes, public.reporte(), con GROUP BY ROLLUP:
--    todos los niveles de detalle y subtotales en una sola consulta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Usuarios y roles
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text,
  nombre   text,
  rol      text not null default 'lector' check (rol in ('admin', 'tecnico', 'lector')),
  creado   timestamptz not null default now()
);

create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function public.crear_perfil() from public;

drop trigger if exists al_crear_usuario_perfil on auth.users;
create trigger al_crear_usuario_perfil after insert on auth.users
  for each row execute function public.crear_perfil();

insert into public.perfiles (user_id, email) select id, email from auth.users on conflict (user_id) do nothing;

create or replace function public.rol_actual() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.rol from public.perfiles p where p.user_id = auth.uid()), 'anonimo');
$$;
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.rol_actual() = 'admin';
$$;
create or replace function public.es_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.rol_actual() in ('admin', 'tecnico');
$$;

-- ---------------------------------------------------------------------
-- 2. Catálogos
-- ---------------------------------------------------------------------
create table if not exists public.gestiones (
  anio              integer primary key check (anio between 2000 and 2100),
  estado            text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  tasa_presupuesto  numeric(10,4) not null default 6.96 check (tasa_presupuesto > 0), -- Bs por USD para el presupuesto
  nota              text,
  creado            timestamptz not null default now()
);

create table if not exists public.financiadores (
  codigo  text primary key,            -- tal como viene en la columna "fondo"
  nombre  text not null,
  activo  boolean not null default true
);

create table if not exists public.regiones (
  codigo  text primary key,            -- LP, SC, ...
  nombre  text not null
);

create table if not exists public.areas (
  nombre  text primary key
);

create table if not exists public.rubros (
  codigo    text primary key,          -- '4'
  nombre    text not null,             -- 'Consultoria'
  etiqueta  text not null,             -- '4. Consultoria'
  orden     integer[] not null default '{}'
);

create table if not exists public.cuentas (
  codigo        text primary key,      -- '4.1'
  nombre        text not null,
  etiqueta      text not null,         -- '4.1 Videos'
  orden         integer[] not null default '{}',
  rubro_codigo  text references public.rubros(codigo) on update cascade on delete set null  -- rubro "natural" según el código
);

create table if not exists public.cuentas_contables (
  codigo  text primary key,            -- código del plan de cuentas del sistema contable
  nombre  text
);

create table if not exists public.tipos_cambio (
  fecha   date not null,
  moneda  text not null default 'USD',
  tasa    numeric(10,4) not null check (tasa > 0),
  fuente  text not null default 'manual',  -- 'importacion' (sale de los movimientos) o 'manual'
  veces   integer not null default 1,      -- cuántos movimientos usaron esta tasa ese día
  primary key (fecha, moneda, tasa, fuente)
);

-- ---------------------------------------------------------------------
-- 3. Importaciones (con su informe de validación)
-- ---------------------------------------------------------------------
create table if not exists public.importaciones (
  id          bigint generated always as identity primary key,
  gestion     integer not null references public.gestiones(anio) on update cascade,
  archivo     text not null,
  sha256      text not null,
  modo        text not null default 'sincronizar' check (modo in ('sincronizar', 'agregar')),
  estado      text not null default 'borrador' check (estado in ('borrador', 'aplicada', 'descartada')),
  resumen     jsonb not null default '{}',   -- totales que calculó el importador al leer el Excel
  resultado   jsonb,                         -- qué cambió al aplicarla
  creado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  creado      timestamptz not null default now(),
  aplicado    timestamptz
);
create index if not exists importaciones_gestion on public.importaciones (gestion, creado desc);

create table if not exists public.validaciones (
  id              bigint generated always as identity primary key,
  importacion_id  bigint not null references public.importaciones(id) on delete cascade,
  codigo          text not null,
  severidad       text not null check (severidad in ('error', 'advertencia', 'info')),
  titulo          text not null,
  detalle         text,
  filas           integer,
  monto_bs        numeric(16,2),
  datos           jsonb
);
create index if not exists validaciones_importacion on public.validaciones (importacion_id);

-- Zona de carga: las filas viven aquí solo mientras la importación es borrador.
create table if not exists public.importacion_filas (
  importacion_id  bigint not null references public.importaciones(id) on delete cascade,
  tipo            text not null check (tipo in ('presupuesto', 'movimiento')),
  clave           text not null,
  datos           jsonb not null,
  primary key (importacion_id, tipo, clave)
);

-- ---------------------------------------------------------------------
-- 4. Presupuestos, modificaciones y movimientos
-- ---------------------------------------------------------------------
create table if not exists public.presupuestos (
  id              bigint generated always as identity primary key,
  gestion         integer not null references public.gestiones(anio) on update cascade,
  mes             smallint check (mes between 1 and 12),            -- null = presupuesto anual
  financiador     text not null references public.financiadores(codigo) on update cascade,
  region          text not null references public.regiones(codigo) on update cascade,
  area            text not null references public.areas(nombre) on update cascade,
  rubro           text not null references public.rubros(codigo) on update cascade,
  cuenta          text references public.cuentas(codigo) on update cascade,
  monto_bs        numeric(16,2) not null,
  clave           text not null,
  importacion_id  bigint references public.importaciones(id) on delete set null,
  fila_origen     integer,
  constraint presupuestos_clave unique (gestion, clave)
);
create index if not exists presupuestos_gestion on public.presupuestos (gestion, financiador, rubro, cuenta);

create table if not exists public.modificaciones (
  id           bigint generated always as identity primary key,
  gestion      integer not null references public.gestiones(anio) on update cascade,
  mes          smallint check (mes between 1 and 12),
  financiador  text not null references public.financiadores(codigo) on update cascade,
  region       text not null references public.regiones(codigo) on update cascade,
  area         text not null references public.areas(nombre) on update cascade,
  rubro        text not null references public.rubros(codigo) on update cascade,
  cuenta       text references public.cuentas(codigo) on update cascade,
  monto_bs     numeric(16,2) not null check (monto_bs <> 0),     -- + incremento, − reducción
  motivo       text not null,
  documento    text,
  fecha        date not null default current_date,
  creado_por   uuid default auth.uid() references auth.users(id) on delete set null,
  creado       timestamptz not null default now()
);
create index if not exists modificaciones_gestion on public.modificaciones (gestion);

create table if not exists public.movimientos (
  id               bigint generated always as identity primary key,
  gestion          integer not null references public.gestiones(anio) on update cascade,
  mes              smallint not null check (mes between 1 and 12),
  fecha            date,
  tipo             smallint,
  numero           integer,
  no_cheque        text,
  financiador      text not null references public.financiadores(codigo) on update cascade,
  region           text not null references public.regiones(codigo) on update cascade,
  area             text not null references public.areas(nombre) on update cascade,
  rubro            text not null references public.rubros(codigo) on update cascade,
  cuenta           text references public.cuentas(codigo) on update cascade,
  cuenta_contable  text references public.cuentas_contables(codigo) on update cascade,
  nombre_contable  text,
  ref              text,
  debe_bs          numeric(16,2) not null default 0,
  haber_bs         numeric(16,2) not null default 0,
  debe_usd         numeric(16,2) not null default 0,
  haber_usd        numeric(16,2) not null default 0,
  tasa             numeric(10,4),
  ejecutado_bs     numeric(16,2) generated always as (debe_bs - haber_bs) stored,
  ejecutado_usd    numeric(16,2) generated always as (debe_usd - haber_usd) stored,
  clave            text not null,
  importacion_id   bigint references public.importaciones(id) on delete set null,
  fila_origen      integer,
  constraint movimientos_clave unique (gestion, clave)
);
create index if not exists movimientos_gestion_mes on public.movimientos (gestion, mes);
create index if not exists movimientos_gestion_dims on public.movimientos (gestion, financiador, rubro, cuenta);
create index if not exists movimientos_fecha on public.movimientos (fecha desc);

-- ---------------------------------------------------------------------
-- 5. Registro de auditoría (quién cambió qué, cuándo, antes y después)
--    Las importaciones no llenan la auditoría fila por fila: quedan
--    registradas en public.importaciones con su usuario, archivo y resultado.
-- ---------------------------------------------------------------------
create table if not exists public.auditoria (
  id         bigint generated always as identity primary key,
  fecha      timestamptz not null default now(),
  usuario    uuid,
  email      text,
  tabla      text not null,
  operacion  text not null,
  registro   text,
  antes      jsonb,
  despues    jsonb
);
create index if not exists auditoria_fecha on public.auditoria (fecha desc);

create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb;
  v_despues jsonb;
begin
  if current_setting('app.importando', true) = 'on' then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then v_antes := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_despues := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_antes = v_despues then
    return null;
  end if;
  insert into public.auditoria (usuario, email, tabla, operacion, registro, antes, despues)
  values (auth.uid(),
          (select p.email from public.perfiles p where p.user_id = auth.uid()),
          tg_table_name, tg_op,
          coalesce(v_despues, v_antes) ->> tg_argv[0],
          v_antes, v_despues);
  return null;
end $$;
revoke all on function public.auditar() from public;

do $$
declare
  t record;
begin
  for t in select * from (values
      ('perfiles', 'user_id'), ('gestiones', 'anio'), ('financiadores', 'codigo'), ('regiones', 'codigo'),
      ('areas', 'nombre'), ('rubros', 'codigo'), ('cuentas', 'codigo'), ('tipos_cambio', 'fecha'),
      ('presupuestos', 'id'), ('modificaciones', 'id'), ('movimientos', 'id')) as x(tabla, llave)
  loop
    execute format('drop trigger if exists auditar on public.%I', t.tabla);
    execute format('create trigger auditar after insert or update or delete on public.%I
                    for each row execute function public.auditar(%L)', t.tabla, t.llave);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Seguridad por filas (RLS)
--    admin: todo · tecnico: importar y registrar modificaciones · lector: ver y exportar
-- ---------------------------------------------------------------------
alter table public.perfiles          enable row level security;
alter table public.gestiones         enable row level security;
alter table public.financiadores     enable row level security;
alter table public.regiones          enable row level security;
alter table public.areas             enable row level security;
alter table public.rubros            enable row level security;
alter table public.cuentas           enable row level security;
alter table public.cuentas_contables enable row level security;
alter table public.tipos_cambio      enable row level security;
alter table public.importaciones     enable row level security;
alter table public.validaciones      enable row level security;
alter table public.importacion_filas enable row level security;   -- sin políticas: solo vía funciones
alter table public.presupuestos      enable row level security;
alter table public.modificaciones    enable row level security;
alter table public.movimientos       enable row level security;
alter table public.auditoria         enable row level security;

do $$
declare
  t text;
begin
  -- Lectura para cualquier usuario con sesión
  foreach t in array array['gestiones', 'financiadores', 'regiones', 'areas', 'rubros', 'cuentas', 'cuentas_contables',
                           'tipos_cambio', 'importaciones', 'validaciones', 'presupuestos', 'modificaciones', 'movimientos'] loop
    execute format('drop policy if exists leer on public.%I', t);
    execute format('create policy leer on public.%I for select to authenticated using (true)', t);
  end loop;
  -- Catálogos, gestiones, tipos de cambio y correcciones manuales: solo admin
  foreach t in array array['gestiones', 'financiadores', 'regiones', 'areas', 'rubros', 'cuentas', 'cuentas_contables',
                           'tipos_cambio', 'presupuestos', 'movimientos'] loop
    execute format('drop policy if exists admin_escribe on public.%I', t);
    execute format('create policy admin_escribe on public.%I for all to authenticated
                    using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

drop policy if exists editor_escribe on public.modificaciones;
create policy editor_escribe on public.modificaciones for all to authenticated
  using (public.es_editor()) with check (public.es_editor());

drop policy if exists leer on public.perfiles;
create policy leer on public.perfiles for select to authenticated using (user_id = auth.uid() or public.es_admin());
drop policy if exists admin_edita on public.perfiles;
create policy admin_edita on public.perfiles for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists leer on public.auditoria;
create policy leer on public.auditoria for select to authenticated using (public.es_admin());

-- Permisos explícitos (los proyectos nuevos de Supabase no exponen tablas sin GRANT)
grant usage on schema public to anon, authenticated;
grant select on public.gestiones, public.financiadores, public.regiones, public.areas, public.rubros, public.cuentas,
  public.cuentas_contables, public.tipos_cambio, public.importaciones, public.validaciones, public.presupuestos,
  public.modificaciones, public.movimientos, public.perfiles, public.auditoria to authenticated;
grant insert, update, delete on public.gestiones, public.financiadores, public.regiones, public.areas, public.rubros,
  public.cuentas, public.cuentas_contables, public.tipos_cambio, public.modificaciones to authenticated;
grant update, delete on public.presupuestos, public.movimientos to authenticated;
grant update (rol, nombre) on public.perfiles to authenticated;
revoke all on public.importacion_filas from anon, authenticated;
revoke insert, update, delete on public.auditoria, public.importaciones, public.validaciones from anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Importación en tres pasos: iniciar → cargar (en lotes) → confirmar
-- ---------------------------------------------------------------------
create or replace function public.importacion_iniciar(
  p_gestion integer, p_archivo text, p_sha256 text, p_modo text default 'sincronizar',
  p_resumen jsonb default '{}', p_validaciones jsonb default '[]') returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if not public.es_editor() then
    raise exception 'Solo un admin o un técnico puede importar' using errcode = '42501';
  end if;
  if p_modo not in ('sincronizar', 'agregar') then
    raise exception 'Modo inválido: % (usa sincronizar o agregar)', p_modo;
  end if;
  insert into public.gestiones (anio) values (p_gestion) on conflict (anio) do nothing;
  if exists (select 1 from public.gestiones g where g.anio = p_gestion and g.estado = 'cerrada') then
    raise exception 'La gestión % está cerrada', p_gestion using errcode = '42501';
  end if;

  -- Limpia borradores abandonados de más de un día
  delete from public.importacion_filas f using public.importaciones i
   where f.importacion_id = i.id and i.estado = 'borrador' and i.creado < now() - interval '1 day';
  update public.importaciones set estado = 'descartada'
   where estado = 'borrador' and creado < now() - interval '1 day';

  insert into public.importaciones (gestion, archivo, sha256, modo, resumen)
  values (p_gestion, p_archivo, p_sha256, p_modo, coalesce(p_resumen, '{}'))
  returning id into v_id;

  insert into public.validaciones (importacion_id, codigo, severidad, titulo, detalle, filas, monto_bs, datos)
  select v_id, x.codigo, x.severidad, x.titulo, x.detalle, x.filas, x.monto_bs, x.datos
  from jsonb_to_recordset(case when jsonb_typeof(p_validaciones) = 'array' then p_validaciones else '[]' end)
       as x(codigo text, severidad text, titulo text, detalle text, filas integer, monto_bs numeric, datos jsonb);
  return v_id;
end $$;

create or replace function public._importacion_borrador(p_id bigint) returns public.importaciones
language plpgsql security definer set search_path = '' as $$
declare
  v public.importaciones;
begin
  if not public.es_editor() then
    raise exception 'Solo un admin o un técnico puede importar' using errcode = '42501';
  end if;
  select * into v from public.importaciones i where i.id = p_id for update;
  if not found then
    raise exception 'No existe la importación %', p_id;
  end if;
  if v.estado <> 'borrador' then
    raise exception 'La importación % ya está %', p_id, v.estado;
  end if;
  if v.creado_por is distinct from auth.uid() and not public.es_admin() then
    raise exception 'La importación % es de otro usuario', p_id using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public.importacion_cargar(p_id bigint, p_filas jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  perform public._importacion_borrador(p_id);
  if jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'p_filas debe ser un arreglo JSON';
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    raise exception 'Máximo 2000 filas por lote';
  end if;
  insert into public.importacion_filas (importacion_id, tipo, clave, datos)
  select p_id, x.tipo, x.clave, x.datos
  from jsonb_to_recordset(p_filas) as x(tipo text, clave text, datos jsonb)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public._importacion_diferencias(p_id bigint, p_gestion integer, p_modo text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (
    select f.tipo, f.clave, (f.datos ->> 'monto_bs')::numeric as monto
    from public.importacion_filas f where f.importacion_id = p_id
  ),
  e as (
    select 'presupuesto'::text as tipo, p.clave, p.monto_bs as monto from public.presupuestos p where p.gestion = p_gestion
    union all
    select 'movimiento', m.clave, m.ejecutado_bs from public.movimientos m where m.gestion = p_gestion
  ),
  t as (select unnest(array['presupuesto', 'movimiento']) as tipo)
  select jsonb_object_agg(t.tipo, jsonb_build_object(
    'en_archivo',   (select count(*) from s where s.tipo = t.tipo),
    'nuevos',       (select count(*) from s where s.tipo = t.tipo and not exists (select 1 from e where e.tipo = s.tipo and e.clave = s.clave)),
    'nuevos_bs',    (select coalesce(sum(s.monto), 0) from s where s.tipo = t.tipo and not exists (select 1 from e where e.tipo = s.tipo and e.clave = s.clave)),
    'sin_cambio',   (select count(*) from s where s.tipo = t.tipo and exists (select 1 from e where e.tipo = s.tipo and e.clave = s.clave)),
    'a_eliminar',   case when p_modo = 'sincronizar' then
                      (select count(*) from e where e.tipo = t.tipo and not exists (select 1 from s where s.tipo = e.tipo and s.clave = e.clave))
                    else 0 end,
    'a_eliminar_bs', case when p_modo = 'sincronizar' then
                      (select coalesce(sum(e.monto), 0) from e where e.tipo = t.tipo and not exists (select 1 from s where s.tipo = e.tipo and s.clave = e.clave))
                    else 0 end))
  from t;
$$;

create or replace function public.importacion_vista_previa(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.importaciones;
begin
  v := public._importacion_borrador(p_id);
  return public._importacion_diferencias(p_id, v.gestion, v.modo)
      || jsonb_build_object('importacion_id', v.id, 'gestion', v.gestion, 'modo', v.modo);
end $$;

create or replace function public.importacion_confirmar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.importaciones;
  v_res jsonb;
begin
  v := public._importacion_borrador(p_id);
  perform pg_advisory_xact_lock(7342, v.gestion);      -- una importación por gestión a la vez
  perform set_config('app.importando', 'on', true);    -- la auditoría la cubre la fila de importaciones
  v_res := public._importacion_diferencias(p_id, v.gestion, v.modo);

  -- Catálogos que aparezcan por primera vez
  insert into public.financiadores (codigo, nombre)
    select distinct f.datos ->> 'financiador', f.datos ->> 'financiador'
    from public.importacion_filas f where f.importacion_id = p_id
  on conflict (codigo) do nothing;
  insert into public.regiones (codigo, nombre)
    select distinct on (f.datos ->> 'region') f.datos ->> 'region', coalesce(f.datos ->> 'region_nombre', f.datos ->> 'region')
    from public.importacion_filas f where f.importacion_id = p_id
  on conflict (codigo) do nothing;
  insert into public.areas (nombre)
    select distinct f.datos ->> 'area' from public.importacion_filas f where f.importacion_id = p_id
  on conflict (nombre) do nothing;
  insert into public.rubros (codigo, nombre, etiqueta, orden)
    select distinct on (f.datos ->> 'rubro') f.datos ->> 'rubro', f.datos ->> 'rubro_nombre', f.datos ->> 'rubro_etiqueta',
           coalesce(array(select jsonb_array_elements_text(f.datos -> 'rubro_orden')::integer), '{}')
    from public.importacion_filas f where f.importacion_id = p_id
  on conflict (codigo) do nothing;
  insert into public.cuentas (codigo, nombre, etiqueta, orden, rubro_codigo)
    select distinct on (f.datos ->> 'cuenta') f.datos ->> 'cuenta', f.datos ->> 'cuenta_nombre', f.datos ->> 'cuenta_etiqueta',
           coalesce(array(select jsonb_array_elements_text(f.datos -> 'cuenta_orden')::integer), '{}'),
           (select r.codigo from public.rubros r where r.codigo = f.datos ->> 'cuenta_rubro')
    from public.importacion_filas f where f.importacion_id = p_id and f.datos ->> 'cuenta' is not null
  on conflict (codigo) do nothing;
  insert into public.cuentas_contables (codigo, nombre)
    select distinct on (f.datos ->> 'cuenta_contable') f.datos ->> 'cuenta_contable', f.datos ->> 'nombre_contable'
    from public.importacion_filas f
    where f.importacion_id = p_id and f.tipo = 'movimiento' and f.datos ->> 'cuenta_contable' is not null
  on conflict (codigo) do nothing;

  -- Sincronizar: lo que ya no viene en el archivo se elimina
  if v.modo = 'sincronizar' then
    delete from public.presupuestos p
     where p.gestion = v.gestion
       and not exists (select 1 from public.importacion_filas f
                        where f.importacion_id = p_id and f.tipo = 'presupuesto' and f.clave = p.clave);
    delete from public.movimientos m
     where m.gestion = v.gestion
       and not exists (select 1 from public.importacion_filas f
                        where f.importacion_id = p_id and f.tipo = 'movimiento' and f.clave = m.clave);
  end if;

  insert into public.presupuestos (gestion, mes, financiador, region, area, rubro, cuenta, monto_bs, clave, importacion_id, fila_origen)
  select v.gestion, (d ->> 'mes')::smallint, d ->> 'financiador', d ->> 'region', d ->> 'area', d ->> 'rubro', d ->> 'cuenta',
         (d ->> 'monto_bs')::numeric, f.clave, p_id, (d ->> 'fila')::integer
  from public.importacion_filas f, lateral (select f.datos as d) x
  where f.importacion_id = p_id and f.tipo = 'presupuesto'
  on conflict on constraint presupuestos_clave do nothing;

  insert into public.movimientos (gestion, mes, fecha, tipo, numero, no_cheque, financiador, region, area, rubro, cuenta,
    cuenta_contable, nombre_contable, ref, debe_bs, haber_bs, debe_usd, haber_usd, tasa, clave, importacion_id, fila_origen)
  select v.gestion, (d ->> 'mes')::smallint, (d ->> 'fecha')::date, (d ->> 'tipo')::smallint, (d ->> 'numero')::integer,
         d ->> 'no_cheque', d ->> 'financiador', d ->> 'region', d ->> 'area', d ->> 'rubro', d ->> 'cuenta',
         d ->> 'cuenta_contable', d ->> 'nombre_contable', d ->> 'ref',
         coalesce((d ->> 'debe_bs')::numeric, 0), coalesce((d ->> 'haber_bs')::numeric, 0),
         coalesce((d ->> 'debe_usd')::numeric, 0), coalesce((d ->> 'haber_usd')::numeric, 0),
         (d ->> 'tasa')::numeric, f.clave, p_id, (d ->> 'fila')::integer
  from public.importacion_filas f, lateral (select f.datos as d) x
  where f.importacion_id = p_id and f.tipo = 'movimiento'
  on conflict on constraint movimientos_clave do nothing;

  -- Tipos de cambio usados en la gestión
  delete from public.tipos_cambio t where t.fuente = 'importacion' and extract(year from t.fecha) = v.gestion;
  insert into public.tipos_cambio (fecha, moneda, tasa, fuente, veces)
  select m.fecha, 'USD', m.tasa, 'importacion', count(*)
  from public.movimientos m
  where m.gestion = v.gestion and m.fecha is not null and m.tasa is not null and m.tasa > 0
    and extract(year from m.fecha) = v.gestion
  group by m.fecha, m.tasa;

  delete from public.importacion_filas f where f.importacion_id = p_id;
  update public.importaciones set estado = 'aplicada', aplicado = now(), resultado = v_res where id = p_id;
  return v_res || jsonb_build_object('importacion_id', p_id, 'gestion', v.gestion, 'modo', v.modo);
end $$;

create or replace function public.importacion_descartar(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._importacion_borrador(p_id);
  delete from public.importacion_filas f where f.importacion_id = p_id;
  update public.importaciones set estado = 'descartada' where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 8. Motor de reportes
-- ---------------------------------------------------------------------
do $$ begin
  create type public.filtro_reporte as (
    gestiones integer[], financiadores text[], regiones text[], areas text[], rubros text[], cuentas text[],
    cuentas_contables text[], meses integer[], mes_desde integer, mes_hasta integer, incluir_anual boolean, texto text);
exception when duplicate_object then null;
end $$;

create or replace function public._lista(p jsonb, k text) returns text[]
language sql immutable set search_path = '' as $$
  select case jsonb_typeof(p -> k)
           when 'array'  then nullif(array(select jsonb_array_elements_text(p -> k)), '{}')
           when 'string' then array[p ->> k]
           when 'number' then array[p ->> k]
         end;
$$;

-- Filtros aceptados (todos opcionales; lista vacía = todos):
-- {"gestiones":[2026], "financiadores":[...], "regiones":["LP"], "areas":[...], "rubros":["5"],
--  "cuentas":["5.2"], "cuentas_contables":[...], "meses":[1,2,3], "mes_desde":1, "mes_hasta":9,
--  "incluir_anual":true, "texto":"pasajes"}
-- Sin "gestiones" se usa la gestión más reciente.
create or replace function public.leer_filtros(p_filtros jsonb default '{}') returns public.filtro_reporte
language sql stable set search_path = '' as $$
  select row(
    coalesce(public._lista(p_filtros, 'gestiones')::integer[], (select array[max(g.anio)] from public.gestiones g)),
    public._lista(p_filtros, 'financiadores'),
    public._lista(p_filtros, 'regiones'),
    public._lista(p_filtros, 'areas'),
    public._lista(p_filtros, 'rubros'),
    public._lista(p_filtros, 'cuentas'),
    public._lista(p_filtros, 'cuentas_contables'),
    public._lista(p_filtros, 'meses')::integer[],
    coalesce((p_filtros ->> 'mes_desde')::integer, 1),
    coalesce((p_filtros ->> 'mes_hasta')::integer, 12),
    coalesce((p_filtros ->> 'incluir_anual')::boolean, true),
    nullif(trim(p_filtros ->> 'texto'), '')
  )::public.filtro_reporte;
$$;

create or replace function public.nombre_mes(p_mes integer) returns text
language sql immutable set search_path = '' as $$
  select coalesce((array['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
                         'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'])[p_mes], 'Presupuesto anual');
$$;

-- Presupuesto, modificaciones y ejecución en una sola forma, ya filtrados.
-- Los filtros de mes aplican a movimientos y a presupuestos mensuales; el
-- presupuesto anual (sin mes) entra siempre, salvo "incluir_anual": false.
create or replace function public.datos_reporte(p_filtros jsonb default '{}', p_moneda text default 'BS')
returns table (
  origen text, gestion integer, mes smallint, fecha date,
  financiador text, region text, region_nombre text, area text,
  rubro text, rubro_etiqueta text, rubro_orden integer[],
  cuenta text, cuenta_etiqueta text, cuenta_orden integer[],
  cuenta_contable text, cuenta_contable_nombre text,
  presupuesto numeric, modificacion numeric, ejecutado numeric, movimientos integer)
language sql stable set search_path = '' as $$
  with f as (select * from public.leer_filtros(coalesce(p_filtros, '{}'))),
  base as (
    select 'presupuesto'::text as origen, p.gestion, p.mes, null::date as fecha, p.financiador, p.region, p.area,
           p.rubro, p.cuenta, null::text as cuenta_contable, null::text as nombre_contable,
           p.monto_bs as pres_bs, 0::numeric as mod_bs, 0::numeric as eje_bs, 0::numeric as eje_usd, 0 as movs
    from public.presupuestos p
    union all
    select 'modificacion', m.gestion, m.mes, m.fecha, m.financiador, m.region, m.area, m.rubro, m.cuenta, null, null,
           0, m.monto_bs, 0, 0, 0
    from public.modificaciones m
    union all
    select 'movimiento', v.gestion, v.mes, v.fecha, v.financiador, v.region, v.area, v.rubro, v.cuenta,
           v.cuenta_contable, v.nombre_contable, 0, 0, v.ejecutado_bs, v.ejecutado_usd, 1
    from public.movimientos v
  )
  select b.origen, b.gestion, b.mes, b.fecha, b.financiador, b.region, coalesce(r.nombre, b.region), b.area,
         b.rubro, coalesce(ru.etiqueta, b.rubro), coalesce(ru.orden, '{}'),
         b.cuenta, coalesce(c.etiqueta, '(sin cuenta)'), coalesce(c.orden, '{}'),
         b.cuenta_contable, b.nombre_contable,
         case when upper(p_moneda) = 'USD' then round(b.pres_bs / g.tasa_presupuesto, 2) else b.pres_bs end,
         case when upper(p_moneda) = 'USD' then round(b.mod_bs / g.tasa_presupuesto, 2) else b.mod_bs end,
         case when upper(p_moneda) = 'USD' then b.eje_usd else b.eje_bs end,
         b.movs
  from base b
  cross join f
  join public.gestiones g on g.anio = b.gestion
  left join public.regiones r on r.codigo = b.region
  left join public.rubros ru on ru.codigo = b.rubro
  left join public.cuentas c on c.codigo = b.cuenta
  where b.gestion = any(f.gestiones)
    and (f.financiadores is null or b.financiador = any(f.financiadores))
    and (f.regiones is null or b.region = any(f.regiones))
    and (f.areas is null or b.area = any(f.areas))
    and (f.rubros is null or b.rubro = any(f.rubros))
    and (f.cuentas is null or coalesce(b.cuenta, '') = any(f.cuentas))
    and (f.cuentas_contables is null or b.cuenta_contable = any(f.cuentas_contables))
    and (case when b.mes is null then f.incluir_anual
              else (f.meses is null or b.mes = any(f.meses)) and b.mes between f.mes_desde and f.mes_hasta end);
$$;

-- Reporte jerárquico. p_dimensiones define los niveles en orden, p. ej.
--   '{rubro,cuenta}'  '{financiador,rubro}'  '{area,financiador,rubro}'
--   '{region,area,financiador,rubro,cuenta}'  '{mes}'  '{rubro,gestion}' (comparativo)
-- Devuelve una fila por cada nivel (nivel 0 = Total general, luego subtotales y detalle),
-- ya ordenada para pintarla como árbol: cada subtotal va antes de sus hijos.
-- kN es la llave (para filtrar al hacer clic), dN la etiqueta.
create or replace function public.reporte(p_dimensiones text[] default '{}', p_filtros jsonb default '{}', p_moneda text default 'BS')
returns table (
  nivel integer,
  k1 text, d1 text, k2 text, d2 text, k3 text, d3 text, k4 text, d4 text, k5 text, d5 text, k6 text, d6 text,
  presupuesto numeric, modificaciones numeric, presupuesto_vigente numeric, ejecutado numeric, saldo numeric,
  pct_ejecucion numeric, presupuesto_excel numeric, pct_excel numeric, movimientos bigint)
language plpgsql stable set search_path = '' as $$
declare
  v_dims  text[] := coalesce(p_dimensiones, '{}');
  v_n     integer := coalesce(array_length(coalesce(p_dimensiones, '{}'), 1), 0);
  v_inner text := '';
  v_sel   text := '';
  v_sets  text := '';
  v_ord   text := '';
  v_nivel text := '0';
  v_k text; v_d text; v_o text;
  i integer;
begin
  if v_n > 6 then
    raise exception 'Máximo 6 dimensiones (llegaron %)', v_n;
  end if;
  if upper(coalesce(p_moneda, 'BS')) not in ('BS', 'USD') then
    raise exception 'Moneda inválida: % (usa BS o USD)', p_moneda;
  end if;
  if (select count(distinct x) from unnest(v_dims) x) <> v_n then
    raise exception 'Hay dimensiones repetidas: %', v_dims;
  end if;

  for i in 1..6 loop
    if i <= v_n then
      case v_dims[i]
        when 'gestion'         then v_k := 'b.gestion::text';                v_d := 'b.gestion::text';         v_o := 'b.gestion';
        when 'mes'             then v_k := 'coalesce(b.mes, 0)::text';       v_d := 'public.nombre_mes(b.mes)'; v_o := 'coalesce(b.mes, 13)';
        when 'financiador'     then v_k := 'b.financiador';                  v_d := 'b.financiador';           v_o := 'b.financiador';
        when 'region'          then v_k := 'b.region';                       v_d := 'b.region_nombre';         v_o := 'b.region';
        when 'area'            then v_k := 'b.area';                         v_d := 'b.area';                  v_o := 'b.area';
        when 'rubro'           then v_k := 'b.rubro';                        v_d := 'b.rubro_etiqueta';        v_o := 'b.rubro_orden';
        when 'cuenta'          then v_k := 'coalesce(b.cuenta, '''')';       v_d := 'b.cuenta_etiqueta';       v_o := 'b.cuenta_orden';
        when 'cuenta_contable' then v_k := 'coalesce(b.cuenta_contable, '''')';
                                    v_d := 'coalesce(b.cuenta_contable || '' '' || coalesce(b.cuenta_contable_nombre, ''''), ''(presupuesto)'')';
                                    v_o := 'coalesce(b.cuenta_contable, '''')';
        else
          raise exception 'Dimensión no permitida: %. Usa gestion, mes, financiador, region, area, rubro, cuenta o cuenta_contable', v_dims[i];
      end case;
      v_inner := v_inner || format(', %s as k%s, %s as d%s, %s as o%s', v_k, i, v_d, i, v_o, i);
      v_sel   := v_sel || format(', x.k%1$s, case when grouping(x.k%1$s) = 1 then %2$s else x.d%1$s end', i,
                                 case when i = 1 then '''Total general''' else 'null::text' end);
      v_sets  := v_sets || case when i > 1 then ', ' else '' end || format('(x.k%1$s, x.d%1$s, x.o%1$s)', i);
      v_ord   := v_ord || case when i > 1 then ', ' else '' end
                       || format('grouping(x.k%1$s) %2$s, x.o%1$s, x.k%1$s', i, case when i = 1 then 'asc' else 'desc' end);
      v_nivel := v_nivel || format(' + (1 - grouping(x.k%s))', i);
    elsif i = 1 then
      v_sel := v_sel || ', null::text, ''Total general''::text';
    else
      v_sel := v_sel || ', null::text, null::text';
    end if;
  end loop;

  return query execute format($q$
    select (%1$s)::integer %2$s,
           sum(x.presupuesto),
           sum(x.modificacion),
           sum(x.presupuesto) + sum(x.modificacion),
           sum(x.ejecutado),
           sum(x.presupuesto) + sum(x.modificacion) - sum(x.ejecutado),
           round(sum(x.ejecutado) / nullif(sum(x.presupuesto) + sum(x.modificacion), 0), 4),
           sum(x.presupuesto) + sum(x.ejecutado),
           round(sum(x.ejecutado) / nullif(sum(x.presupuesto) + sum(x.ejecutado), 0), 4),
           sum(x.movimientos)::bigint
    from (select b.* %3$s from public.datos_reporte($1, $2) b) x
    %4$s
    %5$s
  $q$, v_nivel, v_sel, v_inner,
       case when v_n = 0 then '' else 'group by rollup (' || v_sets || ')' end,
       case when v_n = 0 then '' else 'order by ' || v_ord end)
  using coalesce(p_filtros, '{}'::jsonb), upper(coalesce(p_moneda, 'BS'));
end $$;

-- Igual que reporte(), pero en un solo JSON. Úsala desde la web: Supabase corta por defecto en
-- 1.000 filas las respuestas de funciones que devuelven tablas, y un JSON no tiene ese límite.
create or replace function public.reporte_json(p_dimensiones text[] default '{}', p_filtros jsonb default '{}', p_moneda text default 'BS')
returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb)
  from public.reporte(p_dimensiones, p_filtros, p_moneda) with ordinality as r;
$$;

-- Detalle de movimientos con los mismos filtros (más "texto", que busca en la glosa,
-- el nombre contable o el número de comprobante). Paginado; "total" trae el conteo completo.
create or replace function public.detalle_movimientos(p_filtros jsonb default '{}', p_limite integer default 100, p_desplazamiento integer default 0)
returns table (
  id bigint, gestion integer, mes smallint, fecha date, tipo smallint, numero integer, no_cheque text,
  financiador text, region text, area text, rubro text, rubro_etiqueta text, cuenta text, cuenta_etiqueta text,
  cuenta_contable text, nombre_contable text, ref text, debe_bs numeric, haber_bs numeric,
  ejecutado_bs numeric, ejecutado_usd numeric, tasa numeric, total bigint)
language sql stable set search_path = '' as $$
  select v.id, v.gestion, v.mes, v.fecha, v.tipo, v.numero, v.no_cheque,
         v.financiador, v.region, v.area, v.rubro, coalesce(ru.etiqueta, v.rubro), v.cuenta, coalesce(c.etiqueta, '(sin cuenta)'),
         v.cuenta_contable, v.nombre_contable, v.ref, v.debe_bs, v.haber_bs, v.ejecutado_bs, v.ejecutado_usd, v.tasa,
         count(*) over ()
  from public.movimientos v
  cross join public.leer_filtros(coalesce(p_filtros, '{}')) f
  left join public.rubros ru on ru.codigo = v.rubro
  left join public.cuentas c on c.codigo = v.cuenta
  where v.gestion = any(f.gestiones)
    and (f.financiadores is null or v.financiador = any(f.financiadores))
    and (f.regiones is null or v.region = any(f.regiones))
    and (f.areas is null or v.area = any(f.areas))
    and (f.rubros is null or v.rubro = any(f.rubros))
    and (f.cuentas is null or coalesce(v.cuenta, '') = any(f.cuentas))
    and (f.cuentas_contables is null or v.cuenta_contable = any(f.cuentas_contables))
    and (f.meses is null or v.mes = any(f.meses))
    and v.mes between f.mes_desde and f.mes_hasta
    and (f.texto is null or v.ref ilike '%' || f.texto || '%' or v.nombre_contable ilike '%' || f.texto || '%'
         or v.numero::text = f.texto)
  order by v.fecha desc nulls last, v.id desc
  limit least(greatest(coalesce(p_limite, 100), 1), 50000)
  offset greatest(coalesce(p_desplazamiento, 0), 0);
$$;

-- Cuentas cerca del límite, sobregiradas o con gasto sin presupuesto
-- (por financiador → rubro → cuenta). Sirve para el tablero y para avisos.
create or replace function public.alertas_ejecucion(p_filtros jsonb default '{}', p_umbral numeric default 0.8)
returns table (
  financiador text, rubro text, rubro_etiqueta text, cuenta text, cuenta_etiqueta text,
  presupuesto_vigente numeric, ejecutado numeric, pct_ejecucion numeric, alerta text)
language sql stable set search_path = '' as $$
  select r.k1, r.k2, r.d2, r.k3, r.d3, r.presupuesto_vigente, r.ejecutado, r.pct_ejecucion,
         case when r.presupuesto_vigente <= 0 then 'gasto sin presupuesto'
              when r.ejecutado > r.presupuesto_vigente then 'sobregiro'
              else 'cerca del límite' end
  from public.reporte(array['financiador', 'rubro', 'cuenta'], p_filtros, 'BS') r
  where r.nivel = 3 and r.ejecutado > 0
    and (r.presupuesto_vigente <= 0 or r.ejecutado >= coalesce(p_umbral, 0.8) * r.presupuesto_vigente)
  order by r.pct_ejecucion desc nulls first, r.k1, r.k2, r.k3;
$$;

-- Resumen general consolidado: todo lo que necesita el dashboard en una llamada.
create or replace function public.resumen_general(p_filtros jsonb default '{}', p_moneda text default 'BS') returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_f   public.filtro_reporte := public.leer_filtros(coalesce(p_filtros, '{}'));
  v_tot record;
  v_mes integer;
begin
  select * into v_tot from public.reporte('{}', p_filtros, p_moneda);
  select max(m.mes) into v_mes from public.movimientos m
   where m.gestion = any(v_f.gestiones) and m.mes between v_f.mes_desde and v_f.mes_hasta;
  return jsonb_build_object(
    'gestiones', to_jsonb(v_f.gestiones),
    'moneda', upper(coalesce(p_moneda, 'BS')),
    'presupuesto', v_tot.presupuesto,
    'modificaciones', v_tot.modificaciones,
    'presupuesto_vigente', v_tot.presupuesto_vigente,
    'ejecutado', v_tot.ejecutado,
    'saldo', v_tot.saldo,
    'pct_ejecucion', v_tot.pct_ejecucion,
    'presupuesto_excel', v_tot.presupuesto_excel,
    'pct_excel', v_tot.pct_excel,
    'movimientos', v_tot.movimientos,
    'ultimo_mes', v_mes,
    'avance_tiempo', round(coalesce(v_mes, 0) / 12.0, 4),
    'ritmo', round(coalesce(v_tot.pct_ejecucion, 0) - coalesce(v_mes, 0) / 12.0, 4),
    'por_financiador', (select jsonb_agg(jsonb_build_object('clave', r.k1, 'etiqueta', r.d1, 'vigente', r.presupuesto_vigente,
                                         'ejecutado', r.ejecutado, 'saldo', r.saldo, 'pct', r.pct_ejecucion) order by r.ejecutado desc)
                        from public.reporte('{financiador}', p_filtros, p_moneda) r where r.nivel = 1),
    'por_rubro', (select jsonb_agg(jsonb_build_object('clave', r.k1, 'etiqueta', r.d1, 'vigente', r.presupuesto_vigente,
                                   'ejecutado', r.ejecutado, 'saldo', r.saldo, 'pct', r.pct_ejecucion))
                  from public.reporte('{rubro}', p_filtros, p_moneda) r where r.nivel = 1),
    'por_region', (select jsonb_agg(jsonb_build_object('clave', r.k1, 'etiqueta', r.d1, 'vigente', r.presupuesto_vigente,
                                    'ejecutado', r.ejecutado, 'pct', r.pct_ejecucion))
                   from public.reporte('{region}', p_filtros, p_moneda) r where r.nivel = 1),
    'por_mes', (select jsonb_agg(jsonb_build_object('mes', m.mes, 'etiqueta', public.nombre_mes(m.mes), 'ejecutado', m.ejecutado) order by m.mes)
                from (select b.mes, sum(b.ejecutado) as ejecutado from public.datos_reporte(p_filtros, p_moneda) b
                      where b.origen = 'movimiento' group by b.mes) m),
    'alertas', (select count(*) from public.alertas_ejecucion(p_filtros, 0.8)),
    'ultima_importacion', (select jsonb_build_object('id', i.id, 'archivo', i.archivo, 'aplicado', i.aplicado)
                           from public.importaciones i
                           where i.estado = 'aplicada' and i.gestion = any(v_f.gestiones)
                           order by i.aplicado desc limit 1)
  );
end $$;

-- ---------------------------------------------------------------------
-- 8b. Funciones que usa la web. Todo pasa por funciones para que la misma
--     web funcione igual sobre Supabase y sobre FastAPI + Postgres propio.
--     Además de RLS, cada una revisa el rol: así también protege cuando la
--     API se conecta como dueña de las tablas.
-- ---------------------------------------------------------------------
create or replace function public.mi_perfil() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('user_id', p.user_id, 'email', p.email, 'nombre', p.nombre, 'rol', p.rol)
                   from public.perfiles p where p.user_id = auth.uid()), 'null'::jsonb);
$$;

create or replace function public.catalogos() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'gestiones', coalesce((select jsonb_agg(jsonb_build_object('anio', g.anio, 'estado', g.estado,
                                    'tasa_presupuesto', g.tasa_presupuesto, 'nota', g.nota) order by g.anio desc)
                           from public.gestiones g), '[]'::jsonb),
    'financiadores', coalesce((select jsonb_agg(f.codigo order by f.codigo) from public.financiadores f where f.activo), '[]'::jsonb),
    'regiones', coalesce((select jsonb_agg(jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre) order by r.codigo)
                          from public.regiones r
                          where exists (select 1 from public.presupuestos p where p.region = r.codigo)
                             or exists (select 1 from public.movimientos m where m.region = r.codigo)), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(a.nombre order by a.nombre) from public.areas a), '[]'::jsonb),
    'rubros', coalesce((select jsonb_agg(jsonb_build_object('codigo', r.codigo, 'etiqueta', r.etiqueta) order by r.orden, r.codigo)
                        from public.rubros r), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'etiqueta', c.etiqueta,
                                  'rubros', coalesce((select jsonb_agg(x.rubro order by x.rubro) from (
                                      select p.rubro from public.presupuestos p where p.cuenta = c.codigo
                                      union select m.rubro from public.movimientos m where m.cuenta = c.codigo) x), '[]'::jsonb))
                                order by c.orden, c.codigo)
                         from public.cuentas c), '[]'::jsonb)
  );
$$;

-- Cambia cuando se aplica una importación o se toca una modificación: la web lo consulta para refrescarse.
create or replace function public.version_datos() returns text
language sql stable set search_path = '' as $$
  select coalesce((select max(i.id) from public.importaciones i where i.estado = 'aplicada'), 0) || '-' ||
         coalesce((select max(m.id) from public.modificaciones m), 0) || '-' ||
         (select count(*) from public.modificaciones) || '-' ||
         coalesce((select string_agg(g.anio || g.estado || g.tasa_presupuesto, ',' order by g.anio) from public.gestiones g), '');
$$;

-- security definer para mostrar el correo de quién importó o modificó (los lectores no ven otros perfiles)
create or replace function public.listar_importaciones(p_limite integer default 30) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]'::jsonb) from (
    select i.id, i.gestion, i.archivo, i.modo, i.estado, i.creado, i.aplicado, i.resumen, i.resultado,
           p.email as usuario,
           (select jsonb_object_agg(v.severidad, v.n)
              from (select vv.severidad, count(*) as n from public.validaciones vv
                    where vv.importacion_id = i.id group by vv.severidad) v) as validaciones
    from public.importaciones i
    left join public.perfiles p on p.user_id = i.creado_por
    order by i.id desc
    limit least(greatest(coalesce(p_limite, 30), 1), 200)
  ) x;
$$;

create or replace function public.validaciones_de(p_importacion bigint) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(v) - 'importacion_id' order by
           case v.severidad when 'error' then 0 when 'advertencia' then 1 else 2 end, v.id), '[]'::jsonb)
  from public.validaciones v where v.importacion_id = p_importacion;
$$;

create or replace function public.listar_modificaciones(p_filtros jsonb default '{}') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.creado desc, x.id desc), '[]'::jsonb) from (
    select m.id, m.gestion, m.mes, m.financiador, m.region, m.area, m.rubro, coalesce(r.etiqueta, m.rubro) as rubro_etiqueta,
           m.cuenta, coalesce(c.etiqueta, m.cuenta) as cuenta_etiqueta, m.monto_bs, m.motivo, m.documento, m.fecha,
           m.creado, p.email as usuario
    from public.modificaciones m
    cross join public.leer_filtros(coalesce(p_filtros, '{}')) f
    left join public.rubros r on r.codigo = m.rubro
    left join public.cuentas c on c.codigo = m.cuenta
    left join public.perfiles p on p.user_id = m.creado_por
    where m.gestion = any(f.gestiones)
  ) x;
$$;

create or replace function public.registrar_modificacion(p jsonb) returns bigint
language plpgsql set search_path = '' as $$
declare
  v_id bigint;
  v_gestion integer := (p ->> 'gestion')::integer;
begin
  if not public.es_editor() then
    raise exception 'Solo un admin o un técnico puede registrar modificaciones' using errcode = '42501';
  end if;
  if exists (select 1 from public.gestiones g where g.anio = v_gestion and g.estado = 'cerrada') then
    raise exception 'La gestión % está cerrada', v_gestion using errcode = '42501';
  end if;
  if coalesce(nullif(p ->> 'monto_bs', '')::numeric, 0) = 0 then
    raise exception 'El monto no puede ser cero';
  end if;
  if nullif(trim(p ->> 'motivo'), '') is null then
    raise exception 'Escribe el motivo de la modificación';
  end if;
  insert into public.modificaciones (gestion, mes, financiador, region, area, rubro, cuenta, monto_bs, motivo, documento, fecha)
  values (v_gestion, nullif(p ->> 'mes', '')::smallint, p ->> 'financiador', p ->> 'region', p ->> 'area', p ->> 'rubro',
          nullif(p ->> 'cuenta', ''), (p ->> 'monto_bs')::numeric, trim(p ->> 'motivo'), nullif(trim(p ->> 'documento'), ''),
          coalesce(nullif(p ->> 'fecha', '')::date, current_date))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.eliminar_modificacion(p_id bigint) returns void
language plpgsql set search_path = '' as $$
begin
  if not public.es_editor() then
    raise exception 'Solo un admin o un técnico puede eliminar modificaciones' using errcode = '42501';
  end if;
  delete from public.modificaciones m where m.id = p_id;
  if not found then
    raise exception 'No existe la modificación %', p_id;
  end if;
end $$;

create or replace function public.listar_usuarios() returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede ver los usuarios' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', p.email, 'nombre', p.nombre,
                                    'rol', p.rol, 'creado', p.creado) order by p.creado)
                   from public.perfiles p), '[]'::jsonb);
end $$;

create or replace function public.cambiar_rol(p_user_id uuid, p_rol text) returns void
language plpgsql set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede cambiar roles' using errcode = '42501';
  end if;
  if p_rol not in ('admin', 'tecnico', 'lector') then
    raise exception 'Rol inválido: % (usa admin, tecnico o lector)', p_rol;
  end if;
  if p_rol <> 'admin'
     and exists (select 1 from public.perfiles p where p.user_id = p_user_id and p.rol = 'admin')
     and (select count(*) from public.perfiles p where p.rol = 'admin') = 1 then
    raise exception 'No se puede quitar el rol al único admin';
  end if;
  update public.perfiles set rol = p_rol where user_id = p_user_id;
  if not found then
    raise exception 'No existe el usuario';
  end if;
end $$;

create or replace function public.listar_auditoria(p_limite integer default 100, p_tabla text default null) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede ver la auditoría' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (
      select * from public.auditoria x
      where p_tabla is null or x.tabla = p_tabla
      order by x.id desc
      limit least(greatest(coalesce(p_limite, 100), 1), 500)) a), '[]'::jsonb);
end $$;

create or replace function public.actualizar_gestion(p_anio integer, p_estado text default null,
                                                     p_tasa numeric default null, p_nota text default null) returns void
language plpgsql set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede modificar gestiones' using errcode = '42501';
  end if;
  update public.gestiones
     set estado = coalesce(p_estado, estado),
         tasa_presupuesto = coalesce(p_tasa, tasa_presupuesto),
         nota = coalesce(p_nota, nota)
   where anio = p_anio;
  if not found then
    raise exception 'No existe la gestión %', p_anio;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. Quién puede llamar qué
-- ---------------------------------------------------------------------
do $$
declare
  f text;
begin
  -- Internas: nadie desde la API
  foreach f in array array[
      'public._importacion_borrador(bigint)', 'public._importacion_diferencias(bigint, integer, text)',
      'public.auditar()', 'public.crear_perfil()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- Para usuarios con sesión (cada función revisa su propio rol cuando hace falta)
  foreach f in array array[
      'public.rol_actual()', 'public.es_admin()', 'public.es_editor()',
      'public.importacion_iniciar(integer, text, text, text, jsonb, jsonb)', 'public.importacion_cargar(bigint, jsonb)',
      'public.importacion_vista_previa(bigint)', 'public.importacion_confirmar(bigint)', 'public.importacion_descartar(bigint)',
      'public._lista(jsonb, text)', 'public.leer_filtros(jsonb)', 'public.nombre_mes(integer)',
      'public.datos_reporte(jsonb, text)', 'public.reporte(text[], jsonb, text)', 'public.reporte_json(text[], jsonb, text)',
      'public.detalle_movimientos(jsonb, integer, integer)', 'public.alertas_ejecucion(jsonb, numeric)',
      'public.resumen_general(jsonb, text)',
      'public.mi_perfil()', 'public.catalogos()', 'public.version_datos()', 'public.listar_importaciones(integer)',
      'public.validaciones_de(bigint)', 'public.listar_modificaciones(jsonb)', 'public.registrar_modificacion(jsonb)',
      'public.eliminar_modificacion(bigint)', 'public.listar_usuarios()', 'public.cambiar_rol(uuid, text)',
      'public.listar_auditoria(integer, text)', 'public.actualizar_gestion(integer, text, numeric, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 10. Tiempo real: cuando se aplica una importación, todos los tableros se enteran
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['importaciones', 'modificaciones'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 11. Datos iniciales
-- ---------------------------------------------------------------------
insert into public.regiones (codigo, nombre) values
  ('LP', 'La Paz'), ('SC', 'Santa Cruz'), ('CB', 'Cochabamba'), ('OR', 'Oruro'), ('PT', 'Potosí'),
  ('CH', 'Chuquisaca'), ('TJ', 'Tarija'), ('BE', 'Beni'), ('PD', 'Pando')
on conflict (codigo) do nothing;
