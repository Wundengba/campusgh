create or replace function public.normalize_role_key(input_role text)
returns text
language sql
immutable
as $$
  select case
    when regexp_replace(lower(trim(coalesce(input_role, ''))), '[^a-z0-9]+', '_', 'g') = '' then ''
    else regexp_replace(lower(trim(coalesce(input_role, ''))), '[^a-z0-9]+', '_', 'g')
  end
$$;

create or replace function public.current_actor_role_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_email text;
  actor_role text;
begin
  if session_user in ('postgres', 'supabase_admin') then
    return 'super_admin';
  end if;

  begin
    if auth.role() = 'service_role' then
      return 'super_admin';
    end if;
  exception
    when undefined_function then
      null;
  end;

  actor_email := null;
  actor_role := null;

  begin
    actor_email := lower(nullif(auth.jwt() ->> 'email', ''));
  exception
    when undefined_function then
      actor_email := null;
  end;

  begin
    select public.normalize_role_key(p.role)
    into actor_role
    from public.profiles as p
    where p.id = auth.uid()
    limit 1;
  exception
    when undefined_function then
      actor_role := null;
  end;

  if coalesce(actor_role, '') = '' and actor_email is not null then
    select public.normalize_role_key(u.role)
    into actor_role
    from public.users as u
    where lower(u.email) = actor_email
    limit 1;
  end if;

  return nullif(actor_role, '');
end;
$$;

revoke all on function public.current_actor_role_key() from public;
grant execute on function public.current_actor_role_key() to anon, authenticated, service_role;

create or replace function public.current_actor_is_super_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
begin
  if session_user in ('postgres', 'supabase_admin') then
    return true;
  end if;
  actor_role := public.current_actor_role_key();
  return actor_role = 'super_admin';
end;
$$;

revoke all on function public.current_actor_is_super_admin() from public;
grant execute on function public.current_actor_is_super_admin() to anon, authenticated, service_role;

create or replace function public.prevent_non_super_admin_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_role text;
  next_role text;
  previous_role text;
begin
  actor_role := public.current_actor_role_key();
  next_role := public.normalize_role_key(new.role);
  previous_role := case
    when tg_op = 'UPDATE' then public.normalize_role_key(old.role)
    else ''
  end;

  new.role := case when next_role = '' then null else next_role end;

  if next_role = 'super_admin'
     and previous_role <> 'super_admin'
     and actor_role is not null
     and actor_role <> 'super_admin'
     and actor_role <> 'admin' then
    raise exception 'Only admins can assign the super_admin role.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists restrict_users_super_admin_assignment on public.users;
create trigger restrict_users_super_admin_assignment
before insert or update on public.users
for each row execute function public.prevent_non_super_admin_assignment();

drop trigger if exists restrict_profiles_super_admin_assignment on public.profiles;
create trigger restrict_profiles_super_admin_assignment
before insert or update on public.profiles
for each row execute function public.prevent_non_super_admin_assignment();

drop trigger if exists restrict_teachers_super_admin_assignment on public.teachers;
create trigger restrict_teachers_super_admin_assignment
before insert or update on public.teachers
for each row execute function public.prevent_non_super_admin_assignment();

drop trigger if exists restrict_school_admins_super_admin_assignment on public.school_admins;
create trigger restrict_school_admins_super_admin_assignment
before insert or update on public.school_admins
for each row execute function public.prevent_non_super_admin_assignment();
