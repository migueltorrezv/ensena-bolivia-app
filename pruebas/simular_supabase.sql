-- Simula lo mínimo de Supabase para probar el esquema
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
do $$ begin
  create publication supabase_realtime; exception when duplicate_object then null; end $$;
-- Supabase da EXECUTE por defecto a anon/authenticated en funciones nuevas: lo imitamos
alter default privileges in schema public grant execute on functions to anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;
