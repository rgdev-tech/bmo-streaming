-- BMO Streaming — esquema de cuentas, perfiles y biblioteca
--
-- Modelo estilo Netflix/HBO:
--   auth.users  = la CUENTA (el login)
--   profiles    = los PERFILES dentro de esa cuenta (hasta 5)
--   todo lo demás cuelga de profile_id, nunca de la cuenta —
--   así cada perfil tiene su propia lista y su propio "seguir viendo".
--
-- Correr entero en el SQL Editor de Supabase. Es idempotente: se puede
-- re-ejecutar sin romper nada.

-- ── Perfiles ────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 30),
  -- Emoji o clave de color; el cliente decide cómo pintarlo.
  avatar      text not null default '🍿',
  is_kids     boolean not null default false,
  created_at  timestamptz not null default now(),
  -- Dos perfiles con el mismo nombre en la misma cuenta serían indistinguibles
  -- en el selector.
  unique (account_id, name)
);

create index if not exists profiles_account_idx on public.profiles (account_id, created_at);

-- ── Mi Lista ────────────────────────────────────────────────────────────────
-- Se desnormaliza título/pósters a propósito: la lista se tiene que poder
-- pintar sin pegarle a TMDB (y offline). Es una copia barata y estable.

create table if not exists public.list_items (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  tmdb_id       integer not null,
  media_type    text not null check (media_type in ('movie', 'tv')),
  title         text not null,
  poster_path   text,
  backdrop_path text,
  added_at      timestamptz not null default now(),
  primary key (profile_id, media_type, tmdb_id)
);

create index if not exists list_items_recent_idx
  on public.list_items (profile_id, added_at desc);

-- ── Progreso de reproducción ────────────────────────────────────────────────
-- POR EPISODIO, no uno por serie. El modelo local guardaba una sola posición
-- por título, así que dejar S1E5 a la mitad y abrir S1E3 pisaba el progreso de
-- E5. Acá cada episodio conserva el suyo y "seguir viendo" se deriva (ver la
-- vista continue_watching).
--
-- season/episode = 0 para películas: son parte de la PK y no pueden ser NULL.

create table if not exists public.progress (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  tmdb_id       integer not null,
  media_type    text not null check (media_type in ('movie', 'tv')),
  season        smallint not null default 0,
  episode       smallint not null default 0,
  title         text not null,
  poster_path   text,
  backdrop_path text,
  position_s    integer not null default 0 check (position_s >= 0),
  duration_s    integer not null default 0 check (duration_s >= 0),
  updated_at    timestamptz not null default now(),
  primary key (profile_id, media_type, tmdb_id, season, episode)
);

create index if not exists progress_recent_idx
  on public.progress (profile_id, updated_at desc);

-- ── Episodios vistos ────────────────────────────────────────────────────────

create table if not exists public.watched_episodes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tmdb_id    integer not null,
  season     smallint not null,
  episode    smallint not null,
  watched_at timestamptz not null default now(),
  primary key (profile_id, tmdb_id, season, episode)
);

create index if not exists watched_by_show_idx
  on public.watched_episodes (profile_id, tmdb_id);

-- ── Ajustes por perfil ──────────────────────────────────────────────────────
-- Hoy son globales del dispositivo; pasan a ser por perfil (como Netflix).
-- El estilo de subtítulos va en jsonb: es un blob de presentación que cambia
-- seguido y no se consulta ni se filtra desde SQL.

create table if not exists public.profile_settings (
  profile_id     uuid primary key references public.profiles (id) on delete cascade,
  audio_lang     text not null default 'latino' check (audio_lang in ('original', 'latino')),
  subtitle_style jsonb not null default
    '{"size":"medium","color":"white","background":"none"}'::jsonb,
  updated_at     timestamptz not null default now()
);

-- ── Seguir viendo ───────────────────────────────────────────────────────────
-- Una fila por título (el episodio tocado más recientemente), excluyendo lo ya
-- terminado. Replica la regla que hoy vive en saveProgress():
--   > 92% visto  → terminado, sale de la lista
--   < 10 s       → no cuenta como "empezado"
--
-- security_invoker: sin esto la vista correría con los permisos del OWNER y
-- saltearía el RLS de progress — cualquier usuario vería el progreso de todos.
create or replace view public.continue_watching
with (security_invoker = true) as
select distinct on (p.profile_id, p.media_type, p.tmdb_id)
  p.profile_id, p.tmdb_id, p.media_type, p.season, p.episode,
  p.title, p.poster_path, p.backdrop_path,
  p.position_s, p.duration_s, p.updated_at
from public.progress p
where p.position_s >= 10
  and (p.duration_s = 0 or p.position_s::numeric / p.duration_s < 0.92)
order by p.profile_id, p.media_type, p.tmdb_id, p.updated_at desc;

-- ── Automatismos ────────────────────────────────────────────────────────────

-- Primer perfil al crear la cuenta: sin esto el usuario entra a una app vacía
-- y sin forma de guardar nada.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (account_id, name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Perfil 1')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Cada perfil arranca con sus ajustes por defecto.
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile_settings (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- Tope de 5 perfiles por cuenta.
create or replace function public.enforce_profile_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.profiles where account_id = new.account_id) >= 5 then
    raise exception 'Máximo 5 perfiles por cuenta';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_limit on public.profiles;
create trigger profiles_limit
  before insert on public.profiles
  for each row execute function public.enforce_profile_limit();

-- updated_at automático: el cliente hace upsert seguido y no debe encargarse
-- de mantener el reloj (además el suyo puede estar desfasado).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch
  before update on public.progress
  for each row execute function public.touch_updated_at();

drop trigger if exists settings_touch on public.profile_settings;
create trigger settings_touch
  before update on public.profile_settings
  for each row execute function public.touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- El registro está abierto, así que el RLS es lo ÚNICO que separa a un usuario
-- de otro. Todas las tablas quedan cerradas por defecto y cada fila se valida
-- contra el dueño del perfil.

alter table public.profiles         enable row level security;
alter table public.list_items       enable row level security;
alter table public.progress         enable row level security;
alter table public.watched_episodes enable row level security;
alter table public.profile_settings enable row level security;

-- ¿El perfil pertenece a quien hace la consulta?
-- security definer para poder leer profiles sin recursión de policies.
create or replace function public.owns_profile(p uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p and account_id = auth.uid()
  );
$$;

drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles
  for all to authenticated
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

drop policy if exists list_items_owner on public.list_items;
create policy list_items_owner on public.list_items
  for all to authenticated
  using (public.owns_profile(profile_id))
  with check (public.owns_profile(profile_id));

drop policy if exists progress_owner on public.progress;
create policy progress_owner on public.progress
  for all to authenticated
  using (public.owns_profile(profile_id))
  with check (public.owns_profile(profile_id));

drop policy if exists watched_owner on public.watched_episodes;
create policy watched_owner on public.watched_episodes
  for all to authenticated
  using (public.owns_profile(profile_id))
  with check (public.owns_profile(profile_id));

drop policy if exists settings_owner on public.profile_settings;
create policy settings_owner on public.profile_settings
  for all to authenticated
  using (public.owns_profile(profile_id))
  with check (public.owns_profile(profile_id));

-- ── Para cerrar el registro más adelante ────────────────────────────────────
-- Si algún día querés que no entre cualquiera (tu cuota de Real-Debrid es
-- compartida entre todos los que se registren), NO hace falta migrar nada:
-- basta con desactivar "Enable signup" en Authentication → Providers, o crear
-- una tabla de emails permitidos y validarla en handle_new_user().
