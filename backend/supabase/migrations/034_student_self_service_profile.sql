create or replace function public.update_student_self_service_profile(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_row public.students%rowtype;
  email_value text;
  phone_value text;
  institution_value text;
  district_value text;
  display_name_value text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to update your profile.';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'Enter at least one profile update.';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_changes) as keys(key)
     where key not in (
       'display_name',
       'class',
       'institution',
       'region',
       'district',
       'contact_email',
       'personal_contact',
       'parent_contact',
       'home_address',
       'home_town',
       'place_of_residence',
       'postal_town',
       'po_box',
       'photo_url'
     )
  ) then
    raise exception 'One or more selected profile fields can only be changed by an administrator.';
  end if;

  if p_changes ? 'class'
     and coalesce(p_changes->>'class', '') not in ('JHS', 'SHS', 'University') then
    raise exception 'Choose JHS, SHS, or University.';
  end if;

  display_name_value := nullif(btrim(p_changes->>'display_name'), '');
  if p_changes ? 'display_name'
     and display_name_value is not null
     and length(display_name_value) > 32 then
    raise exception 'Display name must be 32 characters or fewer.';
  end if;
  institution_value := nullif(btrim(p_changes->>'institution'), '');
  if p_changes ? 'institution'
     and institution_value is not null
     and length(institution_value) > 180 then
    raise exception 'School or institution must be 180 characters or fewer.';
  end if;
  district_value := nullif(btrim(p_changes->>'district'), '');
  if p_changes ? 'district'
     and district_value is not null
     and length(district_value) > 150 then
    raise exception 'District must be 150 characters or fewer.';
  end if;

  email_value := lower(nullif(btrim(p_changes->>'contact_email'), ''));
  if p_changes ? 'contact_email'
     and email_value is not null
     and (
       length(email_value) > 254
       or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     ) then
    raise exception 'Enter a valid email address.';
  end if;

  phone_value := nullif(regexp_replace(btrim(p_changes->>'personal_contact'), '[[:space:]()-]', '', 'g'), '');
  if p_changes ? 'personal_contact'
     and phone_value is not null
     and phone_value !~ '^(\+233[0-9]{9}|0[0-9]{9})$' then
    raise exception 'Enter a valid Ghanaian phone number.';
  end if;
  if p_changes ? 'photo_url'
     and (
       length(coalesce(p_changes->>'photo_url', '')) > 2048
       or coalesce(p_changes->>'photo_url', '') !~ '^https?://'
     ) then
    raise exception 'Choose a valid profile photo.';
  end if;

  update public.students
     set display_name = case when p_changes ? 'display_name' then display_name_value else display_name end,
         class = case when p_changes ? 'class' then p_changes->>'class' else class end,
         institution = case when p_changes ? 'institution' then institution_value else institution end,
         region = case when p_changes ? 'region' then nullif(btrim(p_changes->>'region'), '') else region end,
         district = case when p_changes ? 'district' then district_value else district end,
         contact_email = case when p_changes ? 'contact_email' then email_value else contact_email end,
         personal_contact = case when p_changes ? 'personal_contact' then phone_value else personal_contact end,
         parent_contact = case when p_changes ? 'parent_contact' then nullif(btrim(p_changes->>'parent_contact'), '') else parent_contact end,
         home_address = case when p_changes ? 'home_address' then nullif(btrim(p_changes->>'home_address'), '') else home_address end,
         home_town = case when p_changes ? 'home_town' then nullif(btrim(p_changes->>'home_town'), '') else home_town end,
         place_of_residence = case when p_changes ? 'place_of_residence' then nullif(btrim(p_changes->>'place_of_residence'), '') else place_of_residence end,
         postal_town = case when p_changes ? 'postal_town' then nullif(btrim(p_changes->>'postal_town'), '') else postal_town end,
         po_box = case when p_changes ? 'po_box' then nullif(btrim(p_changes->>'po_box'), '') else po_box end,
         photo_url = case when p_changes ? 'photo_url' then nullif(btrim(p_changes->>'photo_url'), '') else photo_url end
   where auth_user_id = auth.uid()
   returning * into student_row;

  if not found then
    raise exception 'No student profile is linked to this account.';
  end if;

  return to_jsonb(student_row);
end;
$$;

revoke all on function public.update_student_self_service_profile(jsonb)
  from public, anon;
grant execute on function public.update_student_self_service_profile(jsonb)
  to authenticated;

drop policy if exists student_photos_select_own on storage.objects;
create policy student_photos_select_own
on storage.objects
for select to authenticated
using (
  bucket_id = 'student-photos'
  and exists (
    select 1
      from public.students
     where students.auth_user_id = auth.uid()
       and coalesce(nullif(students.index_number, ''), students.index::text) =
           (storage.foldername(name))[1]
  )
);

drop policy if exists student_photos_insert_own on storage.objects;
create policy student_photos_insert_own
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'student-photos'
  and exists (
    select 1
      from public.students
     where students.auth_user_id = auth.uid()
       and coalesce(nullif(students.index_number, ''), students.index::text) =
           (storage.foldername(name))[1]
  )
);

drop policy if exists student_photos_update_own on storage.objects;
create policy student_photos_update_own
on storage.objects
for update to authenticated
using (
  bucket_id = 'student-photos'
  and exists (
    select 1
      from public.students
     where students.auth_user_id = auth.uid()
       and coalesce(nullif(students.index_number, ''), students.index::text) =
           (storage.foldername(name))[1]
  )
)
with check (
  bucket_id = 'student-photos'
  and exists (
    select 1
      from public.students
     where students.auth_user_id = auth.uid()
       and coalesce(nullif(students.index_number, ''), students.index::text) =
           (storage.foldername(name))[1]
  )
);

drop policy if exists student_photos_delete_own on storage.objects;
create policy student_photos_delete_own
on storage.objects
for delete to authenticated
using (
  bucket_id = 'student-photos'
  and exists (
    select 1
      from public.students
     where students.auth_user_id = auth.uid()
       and coalesce(students.index_number, students.index::text) =
           (storage.foldername(name))[1]
  )
);
