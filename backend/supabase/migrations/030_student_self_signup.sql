alter table public.profiles
  add column if not exists display_name text;

alter table public.students
  add column if not exists display_name text,
  add column if not exists institution text,
  add column if not exists district text,
  add column if not exists contact_email text;

create unique index if not exists students_contact_email_lower_uidx
  on public.students (lower(contact_email))
  where contact_email is not null;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'student-photos',
  'student-photos',
  true,
  1048576,
  array['image/jpeg']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
