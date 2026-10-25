insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'student-documents',
  'student-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists student_documents_select_own on storage.objects;
create policy student_documents_select_own
on storage.objects
for select to authenticated
using (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = public.current_student_record_id()::text
);

drop policy if exists student_documents_admin_select
on storage.objects;
create policy student_documents_admin_select
on storage.objects
for select to authenticated
using (
  bucket_id = 'student-documents'
  and public.is_current_user_admin()
);

drop policy if exists student_documents_insert_own on storage.objects;
create policy student_documents_insert_own
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = public.current_student_record_id()::text
);

drop policy if exists student_documents_delete_own on storage.objects;
create policy student_documents_delete_own
on storage.objects
for delete to authenticated
using (
  bucket_id = 'student-documents'
  and (storage.foldername(name))[1] = public.current_student_record_id()::text
);
