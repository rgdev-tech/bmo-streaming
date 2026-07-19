-- PIN de 4 dígitos por perfil (bloqueo estilo Netflix).
--
-- Diseño: el PIN se guarda HASHEADO con bcrypt y la verificación ocurre en el
-- servidor. El cliente nunca puede leer el hash — solo pregunta "¿este PIN es
-- correcto?" y recibe true/false.
--
-- Por qué no basta con guardarlo y comparar en la app: el RLS deja que el
-- dueño de la cuenta lea sus propios perfiles, así que un PIN en texto plano
-- (o un hash legible) sería visible con una consulta desde el mismo teléfono,
-- que es exactamente de quien lo estamos protegiendo.
--
-- Correr entero en el SQL Editor. Es idempotente.

create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  add column if not exists pin_hash text;

-- Columna derivada y legible: la UI necesita saber QUÉ perfiles están
-- bloqueados para dibujar el candado, sin poder ver el hash.
alter table public.profiles
  add column if not exists has_pin boolean
  generated always as (pin_hash is not null) stored;

-- El cliente hace select de columnas explícitas; aun así revocamos el hash a
-- nivel de columna para que ni un `select *` accidental lo devuelva.
revoke select (pin_hash) on public.profiles from authenticated, anon;

-- Bloquea las escrituras directas: sin esto, alguien podría poner pin_hash a
-- NULL desde el cliente y saltarse el candado. Solo las funciones de abajo
-- (security definer) pueden tocarlo.
revoke update (pin_hash) on public.profiles from authenticated, anon;

-- ── Poner / quitar PIN ──────────────────────────────────────────────────────

create or replace function public.set_profile_pin(p_profile uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- La comprobación de propiedad va acá adentro: la función es security
  -- definer, o sea que corre con permisos elevados y saltea el RLS.
  if not public.owns_profile(p_profile) then
    raise exception 'Perfil no encontrado';
  end if;

  if p_pin is null then
    update public.profiles set pin_hash = null where id = p_profile;
    return;
  end if;

  if p_pin !~ '^\d{4}$' then
    raise exception 'El PIN debe ser de 4 dígitos';
  end if;

  update public.profiles
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   where id = p_profile;
end;
$$;

-- ── Verificar PIN ───────────────────────────────────────────────────────────

create or replace function public.verify_profile_pin(p_profile uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored text;
begin
  if not public.owns_profile(p_profile) then
    return false;
  end if;

  select pin_hash into stored from public.profiles where id = p_profile;

  -- Sin PIN configurado el perfil está abierto.
  if stored is null then
    return true;
  end if;

  return stored = extensions.crypt(p_pin, stored);
end;
$$;

revoke all on function public.set_profile_pin(uuid, text) from anon;
revoke all on function public.verify_profile_pin(uuid, text) from anon;
grant execute on function public.set_profile_pin(uuid, text) to authenticated;
grant execute on function public.verify_profile_pin(uuid, text) to authenticated;

-- Nota: un PIN de 4 dígitos son 10.000 combinaciones. bcrypt hace que probarlas
-- sea lento, pero no imposible para quien tenga la sesión. Es un candado
-- doméstico —para que otro perfil de la casa no entre al tuyo—, no una
-- frontera de seguridad real. Si algún día hace falta, el paso siguiente es
-- contar intentos fallidos por perfil y bloquear temporalmente.
