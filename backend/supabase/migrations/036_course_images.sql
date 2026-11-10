alter table public.courses
  add column if not exists cover_image_path text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'course-images',
  'course-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists course_images_select on storage.objects;
create policy course_images_select
on storage.objects
for select to authenticated
using (
  bucket_id = 'course-images'
  and (
    exists (
      select 1
        from public.profiles
       where profiles.id = auth.uid()
         and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
    )
    or exists (
      select 1
        from public.courses
       where courses.is_published
         and (
           courses.cover_image_path = storage.objects.name
           or exists (
             select 1
               from jsonb_array_elements(courses.lessons) as lesson(value)
               cross join lateral jsonb_array_elements(
                 case
                   when jsonb_typeof(lesson.value -> 'images') = 'array'
                     then lesson.value -> 'images'
                   else '[]'::jsonb
                 end
               ) as image(value)
              where image.value ->> 'path' = storage.objects.name
           )
         )
    )
  )
);

drop policy if exists course_images_admin_insert on storage.objects;
create policy course_images_admin_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'course-images'
  and exists (
    select 1
      from public.profiles
     where profiles.id = auth.uid()
       and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
  )
);

drop policy if exists course_images_admin_update on storage.objects;
create policy course_images_admin_update
on storage.objects
for update to authenticated
using (
  bucket_id = 'course-images'
  and exists (
    select 1
      from public.profiles
     where profiles.id = auth.uid()
       and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
  )
)
with check (
  bucket_id = 'course-images'
  and exists (
    select 1
      from public.profiles
     where profiles.id = auth.uid()
       and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
  )
);

drop policy if exists course_images_admin_delete on storage.objects;
create policy course_images_admin_delete
on storage.objects
for delete to authenticated
using (
  bucket_id = 'course-images'
  and exists (
    select 1
      from public.profiles
     where profiles.id = auth.uid()
       and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
  )
);
