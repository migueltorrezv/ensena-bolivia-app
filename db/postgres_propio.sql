-- =====================================================================
-- SOLO para el modo FastAPI + SQLAlchemy con un PostgreSQL propio
-- (Docker, Neon, Render, Railway...). NO lo corras en Supabase.
--
-- Crea lo poco que Supabase trae de fábrica y que esquema.sql usa:
-- el esquema auth con auth.users y auth.uid(), y los roles anon/authenticated.
-- Orden: 1) este archivo  2) esquema.sql   (o: python api/iniciar_db.py)
-- =====================================================================
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

-- La API cambia a "authenticated" en cada consulta para que se apliquen los permisos por fila.
do $$ begin
  execute format('grant authenticated to %I', current_user);
exception when others then
  raise notice 'No se pudo dar el rol authenticated a %: la API igual protege con los chequeos de cada función', current_user;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;

create table if not exists auth.users (
  id      uuid primary key default gen_random_uuid(),
  email   text not null unique,
  creado  timestamptz not null default now()
);

-- Contraseñas (hash scrypt). Nadie las lee desde la web: solo la API al iniciar sesión.
create table if not exists auth.credenciales (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  hash         text not null,
  actualizado  timestamptz not null default now()
);
revoke all on auth.users, auth.credenciales from anon, authenticated;

-- Igual que en Supabase: el usuario de la petición viaja en request.jwt.claim.sub
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
