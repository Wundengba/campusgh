alter table public.users add column if not exists managed_school_name text;
alter table public.profiles add column if not exists managed_school_name text;
alter table public.teachers add column if not exists role text;
alter table public.school_admins add column if not exists role text;

update public.users
set role = case
  when regexp_replace(lower(trim(coalesce(role, 'student'))), '[^a-z0-9]+', '_', 'g') = '' then 'student'
  else regexp_replace(lower(trim(coalesce(role, 'student'))), '[^a-z0-9]+', '_', 'g')
end;

update public.profiles
set role = case
  when regexp_replace(lower(trim(coalesce(role, 'student'))), '[^a-z0-9]+', '_', 'g') = '' then 'student'
  else regexp_replace(lower(trim(coalesce(role, 'student'))), '[^a-z0-9]+', '_', 'g')
end;

update public.teachers
set role = case
  when regexp_replace(lower(trim(coalesce(role, 'teacher'))), '[^a-z0-9]+', '_', 'g') = '' then 'teacher'
  else regexp_replace(lower(trim(coalesce(role, 'teacher'))), '[^a-z0-9]+', '_', 'g')
end
where role is null or role <> case
  when regexp_replace(lower(trim(coalesce(role, 'teacher'))), '[^a-z0-9]+', '_', 'g') = '' then 'teacher'
  else regexp_replace(lower(trim(coalesce(role, 'teacher'))), '[^a-z0-9]+', '_', 'g')
end;

update public.school_admins
set role = case
  when regexp_replace(lower(trim(coalesce(role, 'school_admin'))), '[^a-z0-9]+', '_', 'g') = '' then 'school_admin'
  else regexp_replace(lower(trim(coalesce(role, 'school_admin'))), '[^a-z0-9]+', '_', 'g')
end
where role is null or role <> case
  when regexp_replace(lower(trim(coalesce(role, 'school_admin'))), '[^a-z0-9]+', '_', 'g') = '' then 'school_admin'
  else regexp_replace(lower(trim(coalesce(role, 'school_admin'))), '[^a-z0-9]+', '_', 'g')
end;

alter table public.users alter column role set default 'student';
alter table public.profiles alter column role set default 'student';
alter table public.teachers alter column role set default 'teacher';
alter table public.school_admins alter column role set default 'school_admin';

alter table public.users alter column role set not null;
alter table public.profiles alter column role set not null;
alter table public.teachers alter column role set not null;
alter table public.school_admins alter column role set not null;

alter table public.users drop constraint if exists users_role_check;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.teachers drop constraint if exists teachers_role_check;
alter table public.school_admins drop constraint if exists school_admins_role_check;

alter table public.users
add constraint users_role_check
check (role ~ '^[a-z0-9_]+$');

alter table public.profiles
add constraint profiles_role_check
check (role ~ '^[a-z0-9_]+$');

alter table public.teachers
add constraint teachers_role_check
check (role ~ '^[a-z0-9_]+$');

alter table public.school_admins
add constraint school_admins_role_check
check (role ~ '^[a-z0-9_]+$');

create index if not exists teachers_role_idx on public.teachers (role);
create index if not exists school_admins_role_idx on public.school_admins (role);
