-- App No Formalizado: tablas en el proyecto Supabase de Telemercadeo (prefijo nf_, separadas del CRM).
-- Ejecutar una vez en el SQL Editor. Después, ejecutar data/instalar_usuarios.sql (lo genera worker/instalar.py y no se sube a Git).
--
-- Base: el resultado de "app no formalizada.sql" (TUD sin formalizar, último por cédula, 35 días). Se carga a las 11:00 y 15:00.
-- Cada carga actualiza los datos de la solicitud pero conserva el estatus de llamada y los comentarios.
-- Las solicitudes que dejan de salir en la consulta quedan como "salieron de la base" con su motivo; cada carga
-- deja una foto (nf_cargas, nf_cargas_detalle) para el dashboard de evolución.
-- Perfiles: admin (gestiona llamadas y usuarios), generico (solo ve base, segmentación, estatus y dashboard), sistema (carga).
-- Los usuarios del CRM de Telemercadeo no ven estas tablas si no tienen perfil en nf_perfiles.

-- ---------- Perfiles ----------
create table if not exists public.nf_perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique,          -- "carlos.manuel.alvarez.gutierrez" → correo interno usuario@telemercadeo.example
  nombre text not null,
  rol text not null check (rol in ('admin','generico','sistema')),
  activo boolean not null default true,
  cambiar_clave boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.nf_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.nf_perfiles where id = auth.uid() and activo
$$;
create or replace function public.nf_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.nf_rol() = 'admin', false)
$$;
-- Ejecutado desde el SQL Editor (no desde la app)
create or replace function public.nf_es_sql() returns boolean
language sql stable as $$ select current_user not in ('anon','authenticated') $$;

-- ---------- Datos ----------
create table if not exists public.nf_solicitudes (
  solicitud bigint primary key,
  cliente text,
  cedula text,
  tipo_credito text,
  fecha_creacion date,
  monto_solicitado numeric,
  monto_tasa numeric,
  monto_aprobado numeric,
  monto_pagare numeric,
  estado text,
  suc_origen text,
  categorizacion text,
  medio_captacion text,
  telefono text,
  correo text,
  promotor text,
  -- control de la base
  en_base boolean not null default true,
  ingreso_en timestamptz not null default now(),   -- primera carga en que apareció
  ultima_carga timestamptz,
  salida_en timestamptz,
  motivo_salida text,                              -- FORMALIZÓ, NUEVA SOLICITUD DEL CLIENTE, CAMBIÓ DE ESTADO, FUERA DE LOS 35 DÍAS…
  estado_salida text,                              -- estado en el DWH cuando salió
  -- gestión (no la toca la carga)
  estatus_llamada text,
  comentario text,
  gestionado_por text,
  gestionado_en timestamptz,
  gestiones integer not null default 0
);
create index if not exists nf_solicitudes_en_base on public.nf_solicitudes (en_base);

create table if not exists public.nf_gestiones (
  id bigint generated always as identity primary key,
  solicitud bigint not null references public.nf_solicitudes(solicitud) on delete cascade,
  estatus text not null,
  comentario text,
  usuario uuid default auth.uid(),
  nombre text,
  creado_en timestamptz not null default now()
);
create index if not exists nf_gestiones_solicitud on public.nf_gestiones (solicitud);

create table if not exists public.nf_estatus (
  estatus text primary key,
  orden integer not null,
  contacto boolean not null default false    -- cuenta como contacto efectivo en el dashboard
);
insert into public.nf_estatus (estatus, orden, contacto) values
  ('CONTESTA', 1, true), ('DEVOLVER LLAMADA', 2, true), ('NO LE INTERESA', 3, true),
  ('NO CONTESTA', 4, false), ('BUZÓN', 5, false), ('NÚMERO EQUIVOCADO', 6, false)
on conflict (estatus) do nothing;

create table if not exists public.nf_cargas (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  en_base integer not null,
  nuevas integer not null,       -- primera vez en la base
  reingresos integer not null,   -- habían salido y volvieron
  salidas integer not null,
  formalizadas integer not null  -- salidas con motivo FORMALIZÓ
);

create table if not exists public.nf_cargas_detalle (
  carga_id bigint not null references public.nf_cargas(id) on delete cascade,
  solicitud bigint not null,
  estado text,
  tipo_credito text,
  categorizacion text,
  suc_origen text,
  medio_captacion text,
  estatus_llamada text,
  primary key (carga_id, solicitud)
);

-- ---------- Seguridad ----------
alter table public.nf_perfiles enable row level security;
alter table public.nf_solicitudes enable row level security;
alter table public.nf_gestiones enable row level security;
alter table public.nf_estatus enable row level security;
alter table public.nf_cargas enable row level security;
alter table public.nf_cargas_detalle enable row level security;

drop policy if exists leer on public.nf_perfiles;
create policy leer on public.nf_perfiles for select to authenticated using (id = auth.uid() or public.nf_es_admin());

do $$
declare t text;
begin
  foreach t in array array['nf_solicitudes','nf_gestiones','nf_estatus','nf_cargas','nf_cargas_detalle'] loop
    execute format('drop policy if exists leer on public.%I', t);
    execute format('create policy leer on public.%I for select to authenticated using (public.nf_rol() is not null)', t);
  end loop;
end $$;

-- Nadie escribe directo en las tablas: todo pasa por las funciones de abajo
revoke all on public.nf_perfiles, public.nf_solicitudes, public.nf_gestiones, public.nf_estatus,
  public.nf_cargas, public.nf_cargas_detalle from anon, authenticated;
grant select on public.nf_perfiles, public.nf_solicitudes, public.nf_gestiones, public.nf_estatus,
  public.nf_cargas, public.nf_cargas_detalle to authenticated;

-- ---------- Gestión de la llamada (solo admin; el perfil genérico solo consulta) ----------
create or replace function public.nf_gestionar(p_solicitud bigint, p_estatus text, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
declare yo text;
begin
  if not public.nf_es_admin() then raise exception 'Su perfil es de solo consulta'; end if;
  if not exists (select 1 from public.nf_estatus where estatus = p_estatus) then raise exception 'Estatus inválido'; end if;
  select nombre into yo from public.nf_perfiles where id = auth.uid();
  insert into public.nf_gestiones (solicitud, estatus, comentario, nombre)
  values (p_solicitud, p_estatus, nullif(trim(p_comentario), ''), yo);
  update public.nf_solicitudes
  set estatus_llamada = p_estatus, comentario = nullif(trim(p_comentario), ''), gestionado_por = yo,
      gestionado_en = now(), gestiones = gestiones + 1
  where solicitud = p_solicitud;
  if not found then raise exception 'La solicitud % no existe', p_solicitud; end if;
end $$;

-- ---------- Carga (proceso de la PC de la red, perfil sistema) ----------
-- p_filas: el resultado de la consulta. p_salidas: [{solicitud, estado, motivo}] de las que dejaron de salir.
create or replace function public.nf_cargar(p_filas jsonb, p_salidas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_carga bigint; v_nuevas int; v_reingresos int; v_salidas int; v_form int; v_total int;
begin
  if coalesce(public.nf_rol(), '') not in ('sistema','admin') then
    raise exception 'Solo el proceso de carga puede actualizar los datos';
  end if;
  if jsonb_array_length(p_filas) = 0 then raise exception 'La consulta no devolvió filas: no se toca la base'; end if;

  create temp table _f on commit drop as
  select * from jsonb_to_recordset(p_filas) as x(
    solicitud bigint, cliente text, cedula text, tipo_credito text, fecha_creacion date,
    monto_solicitado numeric, monto_tasa numeric, monto_aprobado numeric, monto_pagare numeric,
    estado text, suc_origen text, categorizacion text, medio_captacion text, telefono text, correo text, promotor text);

  select count(*) filter (where s.solicitud is null), count(*) filter (where s.solicitud is not null and not s.en_base)
  into v_nuevas, v_reingresos
  from _f left join public.nf_solicitudes s using (solicitud);

  insert into public.nf_solicitudes as s (solicitud, cliente, cedula, tipo_credito, fecha_creacion, monto_solicitado,
    monto_tasa, monto_aprobado, monto_pagare, estado, suc_origen, categorizacion, medio_captacion, telefono, correo,
    promotor, en_base, ultima_carga)
  select solicitud, cliente, cedula, tipo_credito, fecha_creacion, monto_solicitado, monto_tasa, monto_aprobado,
    monto_pagare, estado, suc_origen, categorizacion, medio_captacion, telefono, correo, promotor, true, now()
  from _f
  on conflict (solicitud) do update set
    cliente = excluded.cliente, cedula = excluded.cedula, tipo_credito = excluded.tipo_credito,
    fecha_creacion = excluded.fecha_creacion, monto_solicitado = excluded.monto_solicitado,
    monto_tasa = excluded.monto_tasa, monto_aprobado = excluded.monto_aprobado, monto_pagare = excluded.monto_pagare,
    estado = excluded.estado, suc_origen = excluded.suc_origen, categorizacion = excluded.categorizacion,
    medio_captacion = excluded.medio_captacion, telefono = excluded.telefono, correo = excluded.correo,
    promotor = excluded.promotor, en_base = true, ultima_carga = now(),
    salida_en = null, motivo_salida = null, estado_salida = null;

  -- Las que estaban en la base y ya no salen en la consulta
  update public.nf_solicitudes s
  set en_base = false, salida_en = now(), estado_salida = x.estado, motivo_salida = coalesce(x.motivo, 'SIN DATO')
  from (select s2.solicitud, sa.estado, sa.motivo
        from public.nf_solicitudes s2
        left join jsonb_to_recordset(p_salidas) as sa(solicitud bigint, estado text, motivo text) using (solicitud)
        where s2.en_base and not exists (select 1 from _f where _f.solicitud = s2.solicitud)) x
  where s.solicitud = x.solicitud;
  get diagnostics v_salidas = row_count;

  select count(*) into v_form from public.nf_solicitudes
  where not en_base and motivo_salida = 'FORMALIZÓ' and salida_en = now();   -- now() es la hora de esta transacción
  select count(*) into v_total from _f;

  insert into public.nf_cargas (en_base, nuevas, reingresos, salidas, formalizadas)
  values (v_total, v_nuevas, v_reingresos, v_salidas, v_form) returning id into v_carga;
  insert into public.nf_cargas_detalle (carga_id, solicitud, estado, tipo_credito, categorizacion, suc_origen,
    medio_captacion, estatus_llamada)
  select v_carga, solicitud, estado, tipo_credito, categorizacion, suc_origen, medio_captacion, estatus_llamada
  from public.nf_solicitudes where en_base;

  return jsonb_build_object('carga', v_carga, 'en_base', v_total, 'nuevas', v_nuevas, 'reingresos', v_reingresos,
                            'salidas', v_salidas, 'formalizadas', v_form);
end $$;

-- ---------- Usuarios ----------
-- Si la persona ya tiene usuario en este Supabase (p. ej. del CRM) solo se le da acceso; si no, se crea con la clave dada.
create or replace function public.nf_crear_usuario(p_usuario text, p_nombre text, p_rol text, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; u text := lower(trim(p_usuario)); correo text := lower(trim(p_usuario)) || '@telemercadeo.example';
begin
  if not (public.nf_es_admin() or public.nf_es_sql()) then raise exception 'Solo el administrador puede crear usuarios'; end if;
  if u !~ '^[a-z0-9._-]+$' then raise exception 'Usuario inválido'; end if;
  if p_rol not in ('admin','generico','sistema') then raise exception 'Perfil inválido'; end if;
  if exists (select 1 from public.nf_perfiles where usuario = u) then raise exception 'Ese usuario ya existe'; end if;
  select id into uid from auth.users where email = correo;
  if uid is null then
    if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', correo,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', p_nombre), now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());
  end if;
  insert into public.nf_perfiles (id, usuario, nombre, rol, cambiar_clave) values (uid, u, trim(p_nombre), p_rol, p_rol <> 'sistema');
  return uid;
end $$;

create or replace function public.nf_editar_usuario(p_id uuid, p_rol text, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.nf_es_admin() then raise exception 'Solo el administrador puede editar usuarios'; end if;
  if p_rol not in ('admin','generico','sistema') then raise exception 'Perfil inválido'; end if;
  if p_id = auth.uid() and (p_rol <> 'admin' or not p_activo) then raise exception 'No puede quitarse a sí mismo el perfil de administrador'; end if;
  update public.nf_perfiles set rol = p_rol, activo = p_activo where id = p_id;
end $$;

create or replace function public.nf_restablecer_clave(p_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.nf_es_admin() then raise exception 'Solo el administrador puede restablecer contraseñas'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  if exists (select 1 from public.perfiles where id = p_id) then
    raise exception 'Este usuario también entra al CRM de Telemercadeo: su contraseña se restablece desde el CRM';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_id and id in (select id from public.nf_perfiles);
  update public.nf_perfiles set cambiar_clave = true where id = p_id;
end $$;

create or replace function public.nf_clave_cambiada() returns void
language sql security definer set search_path = public as $$
  update public.nf_perfiles set cambiar_clave = false where id = auth.uid()
$$;

revoke execute on function public.nf_gestionar(bigint, text, text), public.nf_cargar(jsonb, jsonb),
  public.nf_crear_usuario(text, text, text, text), public.nf_editar_usuario(uuid, text, boolean),
  public.nf_restablecer_clave(uuid, text), public.nf_clave_cambiada() from public, anon;
grant execute on function public.nf_gestionar(bigint, text, text), public.nf_cargar(jsonb, jsonb),
  public.nf_crear_usuario(text, text, text, text), public.nf_editar_usuario(uuid, text, boolean),
  public.nf_restablecer_clave(uuid, text), public.nf_clave_cambiada() to authenticated;
