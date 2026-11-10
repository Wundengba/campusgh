create or replace function public.share_collaborative_study_team_resource(
  p_team_id uuid,
  p_title text,
  p_description text,
  p_resource_type text,
  p_resource_url text default null,
  p_storage_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  resource_id uuid;
begin
  if actor_id is null then
    raise exception 'Sign in to share a resource.' using errcode = '42501';
  end if;

  if not public.is_collaborative_study_team_member(p_team_id) then
    raise exception 'Accept the team invitation before sharing resources.'
      using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_title, ''))) not between 1 and 160
     or length(coalesce(p_description, '')) > 1000 then
    raise exception 'Enter a resource title and a description under 1000 characters.';
  end if;

  if p_resource_type = 'link' then
    if p_resource_url is null
       or p_resource_url !~* '^https?://[^[:space:]]+$'
       or p_storage_path is not null then
      raise exception 'Provide a valid http or https link.';
    end if;
  elsif p_resource_type = 'file' then
    if p_resource_url is not null
       or p_storage_path is null
       or p_storage_path not like p_team_id::text || '/' || actor_id::text || '/%' then
      raise exception 'The uploaded file path is invalid.';
    end if;
    if not exists (
      select 1
        from storage.objects as object
       where object.bucket_id = 'study-team-resources'
         and object.name = p_storage_path
    ) then
      raise exception 'The uploaded resource file could not be found.';
    end if;
  else
    raise exception 'Choose either a link or an uploaded file.';
  end if;

  select coalesce(nullif(btrim(profile.full_name), ''), 'Campus Ghana member')
    into actor_name
    from public.profiles as profile
   where profile.id = actor_id;

  insert into public.collaborative_study_team_resources (
    team_id,
    shared_by,
    shared_by_name,
    title,
    description,
    resource_type,
    resource_url,
    storage_path
  )
  values (
    p_team_id,
    actor_id,
    coalesce(actor_name, 'Campus Ghana member'),
    btrim(p_title),
    btrim(coalesce(p_description, '')),
    p_resource_type,
    p_resource_url,
    p_storage_path
  )
  returning id into resource_id;

  return resource_id;
end;
$$;

revoke all on function public.share_collaborative_study_team_resource(uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.share_collaborative_study_team_resource(uuid, text, text, text, text, text)
  to authenticated;

drop policy if exists collaborative_study_resources_storage_read
  on storage.objects;
create policy collaborative_study_resources_storage_read
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'study-team-resources'
    and exists (
      select 1
        from public.collaborative_study_teams as team
       where team.id::text = (storage.foldername(name))[1]
         and public.is_collaborative_study_team_member(team.id)
    )
  );

drop policy if exists collaborative_study_resources_storage_insert
  on storage.objects;
create policy collaborative_study_resources_storage_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'study-team-resources'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1
        from public.collaborative_study_teams as team
       where team.id::text = (storage.foldername(name))[1]
         and public.is_collaborative_study_team_member(team.id)
    )
  );

drop policy if exists collaborative_study_resources_storage_delete
  on storage.objects;
create policy collaborative_study_resources_storage_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'study-team-resources'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1
        from public.collaborative_study_teams as team
       where team.id::text = (storage.foldername(name))[1]
         and public.is_collaborative_study_team_member(team.id)
    )
  );

drop policy if exists collaborative_study_team_realtime_read
  on realtime.messages;
create policy collaborative_study_team_realtime_read
  on realtime.messages
  for select to authenticated
  using (
    realtime.topic() ~ '^study-team:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_collaborative_study_team_member(
      split_part(realtime.topic(), ':', 2)::uuid
    )
  );

drop policy if exists collaborative_study_team_realtime_write
  on realtime.messages;
create policy collaborative_study_team_realtime_write
  on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() ~ '^study-team:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_collaborative_study_team_member(
      split_part(realtime.topic(), ':', 2)::uuid
    )
  );

do $$
declare
  realtime_table text;
begin
  if exists (
    select 1
      from pg_catalog.pg_publication
     where pubname = 'supabase_realtime'
  ) then
    foreach realtime_table in array array[
      'collaborative_study_team_messages',
      'collaborative_study_team_members',
      'collaborative_study_team_resources'
    ] loop
      if not exists (
        select 1
          from pg_catalog.pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = realtime_table
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          realtime_table
        );
      end if;
    end loop;
  end if;
end;
$$;
