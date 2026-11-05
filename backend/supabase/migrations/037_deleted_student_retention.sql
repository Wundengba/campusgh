alter table public.students
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;

create table if not exists public.deleted_student_accounts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique,
  student_record jsonb not null,
  registered_school_id bigint,
  archived_at timestamptz not null default now(),
  purge_at timestamptz not null default (now() + interval '30 days'),
  archived_by uuid references auth.users (id) on delete set null,
  constraint deleted_student_accounts_purge_after_archive
    check (purge_at > archived_at)
);

create index if not exists deleted_student_accounts_purge_at_idx
  on public.deleted_student_accounts (purge_at);
create index if not exists deleted_student_accounts_school_idx
  on public.deleted_student_accounts (registered_school_id, archived_at desc);

alter table public.deleted_student_accounts enable row level security;
revoke all on public.deleted_student_accounts from public, anon, authenticated;

create or replace function public.current_student_record_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
    from public.students
   where auth_user_id = auth.uid()
     and deleted_at is null
   limit 1;
$$;

drop policy if exists students_authenticated_select_own on public.students;
create policy students_authenticated_select_own on public.students
  for select to authenticated
  using (auth_user_id = auth.uid() and deleted_at is null);

drop policy if exists students_staff_manage on public.students;
create policy students_staff_manage on public.students
  for all to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.profiles
       where id = auth.uid()
         and role in ('admin', 'teacher', 'staff')
    )
  )
  with check (
    deleted_at is null
    and exists (
      select 1 from public.profiles
       where id = auth.uid()
         and role in ('admin', 'teacher', 'staff')
    )
  );

revoke delete on public.students from public, anon, authenticated;

create or replace function public.archive_student_account(p_student_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  actor_school_id bigint;
  student_row public.students%rowtype;
  archived_at_value timestamptz := now();
  purge_at_value timestamptz := now() + interval '30 days';
begin
  actor_role := public.current_actor_role_key();
  if auth.uid() is null or actor_role is null or actor_role not in ('admin', 'school_admin') then
    raise exception 'Only administrators can archive student accounts.'
      using errcode = '42501';
  end if;

  select registered_school_id
    into actor_school_id
    from public.profiles
   where id = auth.uid();

  select *
    into student_row
    from public.students
   where id = p_student_id
     and deleted_at is null
   for update;
  if not found then
    raise exception 'The active student account was not found.'
      using errcode = 'P0002';
  end if;

  if actor_role = 'school_admin'
     and (actor_school_id is null or student_row.registered_school_id is distinct from actor_school_id) then
    raise exception 'You can only archive student accounts for your assigned school.'
      using errcode = '42501';
  end if;

  insert into public.deleted_student_accounts (
    student_id,
    student_record,
    registered_school_id,
    archived_at,
    purge_at,
    archived_by
  )
  values (
    student_row.id,
    to_jsonb(student_row),
    student_row.registered_school_id,
    archived_at_value,
    purge_at_value,
    auth.uid()
  );

  update public.students
     set deleted_at = archived_at_value,
         deleted_by = auth.uid(),
         auth_user_id = null,
         user_id = null
   where id = student_row.id;

  return purge_at_value;
end;
$$;

create or replace function public.list_deleted_student_accounts()
returns table (
  student_id uuid,
  full_name text,
  student_index text,
  student_class text,
  archived_at timestamptz,
  purge_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text;
  actor_school_id bigint;
begin
  actor_role := public.current_actor_role_key();
  if auth.uid() is null or actor_role is null or actor_role not in ('admin', 'school_admin') then
    raise exception 'Only administrators can view archived student accounts.'
      using errcode = '42501';
  end if;

  select registered_school_id
    into actor_school_id
    from public.profiles
   where id = auth.uid();

  return query
    select archive.student_id,
           coalesce(archive.student_record ->> 'full_name', ''),
           coalesce(archive.student_record ->> 'index', archive.student_record ->> 'index_number', ''),
           coalesce(archive.student_record ->> 'class', ''),
           archive.archived_at,
           archive.purge_at
      from public.deleted_student_accounts as archive
     where archive.purge_at > now()
       and (
         actor_role = 'admin'
         or (
           actor_role = 'school_admin'
           and actor_school_id is not null
           and archive.registered_school_id = actor_school_id
         )
       )
     order by archive.archived_at desc;
end;
$$;

create or replace function public.restore_deleted_student_account(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  actor_school_id bigint;
  archive_row public.deleted_student_accounts%rowtype;
begin
  actor_role := public.current_actor_role_key();
  if auth.uid() is null or actor_role is null or actor_role not in ('admin', 'school_admin') then
    raise exception 'Only administrators can restore student accounts.'
      using errcode = '42501';
  end if;

  select registered_school_id
    into actor_school_id
    from public.profiles
   where id = auth.uid();

  select *
    into archive_row
    from public.deleted_student_accounts
   where student_id = p_student_id
   for update;
  if not found or archive_row.purge_at <= now() then
    raise exception 'The archived student account was not found or its retention period has expired.'
      using errcode = 'P0002';
  end if;

  if actor_role = 'school_admin'
     and (actor_school_id is null or archive_row.registered_school_id is distinct from actor_school_id) then
    raise exception 'You can only restore student accounts for your assigned school.'
      using errcode = '42501';
  end if;

  update public.students
     set deleted_at = null,
         deleted_by = null,
         auth_user_id = nullif(archive_row.student_record ->> 'auth_user_id', '')::uuid,
         user_id = nullif(archive_row.student_record ->> 'user_id', '')::uuid
   where id = archive_row.student_id
     and deleted_at is not null;
  if not found then
    raise exception 'The archived student record is missing and cannot be restored.'
      using errcode = 'P0002';
  end if;

  delete from public.deleted_student_accounts
   where id = archive_row.id;
end;
$$;

create or replace function public.purge_expired_deleted_student_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_account record;
  purged_count integer := 0;
begin
  for expired_account in
    select id, student_id
      from public.deleted_student_accounts
     where purge_at <= now()
     order by purge_at
     for update skip locked
  loop
    delete from public.students
     where id = expired_account.student_id
       and deleted_at is not null;

    delete from public.deleted_student_accounts
     where id = expired_account.id;

    purged_count := purged_count + 1;
  end loop;

  return purged_count;
end;
$$;

revoke all on function public.current_student_record_id() from public, anon;
grant execute on function public.current_student_record_id() to authenticated;

revoke all on function public.archive_student_account(uuid) from public, anon;
grant execute on function public.archive_student_account(uuid) to authenticated;

revoke all on function public.list_deleted_student_accounts() from public, anon;
grant execute on function public.list_deleted_student_accounts() to authenticated;

revoke all on function public.restore_deleted_student_account(uuid) from public, anon;
grant execute on function public.restore_deleted_student_account(uuid) to authenticated;

revoke all on function public.purge_expired_deleted_student_accounts() from public, anon, authenticated;
grant execute on function public.purge_expired_deleted_student_accounts() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if not exists (
    select 1 from cron.job
     where jobname = 'purge-deleted-student-accounts'
  ) then
    perform cron.schedule(
      'purge-deleted-student-accounts',
      '0 * * * *',
      'select public.purge_expired_deleted_student_accounts();'
    );
  end if;
end;
$$;
