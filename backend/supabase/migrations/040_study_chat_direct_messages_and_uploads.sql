alter table public.collaborative_study_team_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_type text;

alter table public.collaborative_study_team_messages
  drop constraint if exists collaborative_study_team_message_attachment_check;
alter table public.collaborative_study_team_messages
  add constraint collaborative_study_team_message_attachment_check
  check (
    (attachment_path is null and attachment_type is null)
    or (attachment_path is not null and attachment_type = 'audio')
  );

create table if not exists public.collaborative_study_direct_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_one uuid not null references auth.users (id) on delete cascade,
  participant_two uuid not null references auth.users (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint collaborative_study_direct_participants_ordered
    check (participant_one < participant_two),
  constraint collaborative_study_direct_participants_unique
    unique (participant_one, participant_two)
);

create table if not exists public.collaborative_study_direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.collaborative_study_direct_conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_name text not null,
  content text not null check (length(btrim(content)) between 1 and 4000),
  attachment_path text,
  attachment_type text,
  created_at timestamptz not null default now(),
  constraint collaborative_study_direct_message_attachment_check
    check (
      (attachment_path is null and attachment_type is null)
      or (attachment_path is not null and attachment_type = 'audio')
    )
);

create index if not exists collaborative_study_direct_messages_conversation_idx
  on public.collaborative_study_direct_messages (conversation_id, created_at);

alter table public.collaborative_study_direct_conversations enable row level security;
alter table public.collaborative_study_direct_messages enable row level security;

revoke all on public.collaborative_study_direct_conversations
  from public, anon, authenticated;
revoke all on public.collaborative_study_direct_messages
  from public, anon, authenticated;
grant select on public.collaborative_study_direct_conversations to authenticated;
grant select on public.collaborative_study_direct_messages to authenticated;
revoke insert on public.collaborative_study_team_messages from authenticated;
grant select on public.collaborative_study_team_messages to authenticated;
grant insert (team_id, sender_id, sender_name, content)
  on public.collaborative_study_team_messages to authenticated;

drop policy if exists collaborative_study_direct_conversations_read
  on public.collaborative_study_direct_conversations;
create policy collaborative_study_direct_conversations_read
  on public.collaborative_study_direct_conversations
  for select to authenticated
  using (auth.uid() in (participant_one, participant_two));

drop policy if exists collaborative_study_direct_messages_read
  on public.collaborative_study_direct_messages;
create policy collaborative_study_direct_messages_read
  on public.collaborative_study_direct_messages
  for select to authenticated
  using (
    exists (
      select 1
        from public.collaborative_study_direct_conversations as conversation
       where conversation.id = conversation_id
         and auth.uid() in (conversation.participant_one, conversation.participant_two)
    )
  );

drop policy if exists collaborative_study_direct_messages_insert
  on public.collaborative_study_direct_messages;
create policy collaborative_study_direct_messages_insert
  on public.collaborative_study_direct_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
        from public.collaborative_study_direct_conversations as conversation
       where conversation.id = conversation_id
         and auth.uid() in (conversation.participant_one, conversation.participant_two)
    )
    and attachment_path is null
    and attachment_type is null
  );

create or replace function public.get_collaborative_study_team_members(
  p_team_id uuid
)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  role_key text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.is_collaborative_study_team_member(p_team_id) then
    raise exception 'You must be an accepted team member to view participants.'
      using errcode = '42501';
  end if;

  return query
  select member.id,
         member.user_id,
         coalesce(
           nullif(btrim(profile.display_name), ''),
           nullif(btrim(student.display_name), ''),
           nullif(btrim(profile.full_name), ''),
           nullif(btrim(student.full_name), ''),
           case
             when position('@' in member.display_name) = 0
               then nullif(btrim(member.display_name), '')
           end,
           'Team member'
         ),
         member.role_key,
         student.photo_url
    from public.collaborative_study_team_members as member
    left join public.profiles as profile on profile.id = member.user_id
    left join public.students as student on student.auth_user_id = member.user_id
   where member.team_id = p_team_id
     and member.invitation_status = 'accepted'
   order by member.invited_at;
end;
$$;

create or replace function public.get_collaborative_study_my_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(profile.display_name), ''),
    nullif(btrim(student.display_name), ''),
    nullif(btrim(profile.full_name), ''),
    nullif(btrim(student.full_name), ''),
    'Team member'
  )
    from public.profiles as profile
    left join public.students as student on student.auth_user_id = profile.id
   where profile.id = auth.uid()
     and auth.uid() is not null;
$$;

create or replace function public.get_collaborative_study_direct_conversations()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_url text,
  last_message text,
  last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view direct conversations.'
      using errcode = '42501';
  end if;

  return query
  select conversation.id,
         other_user.id,
         coalesce(
           nullif(btrim(other_profile.display_name), ''),
           nullif(btrim(other_student.display_name), ''),
           nullif(btrim(other_profile.full_name), ''),
           nullif(btrim(other_student.full_name), ''),
           'Team member'
         ),
         other_student.photo_url,
         latest_message.content,
         latest_message.created_at
    from public.collaborative_study_direct_conversations as conversation
    cross join lateral (
      select case
               when conversation.participant_one = auth.uid()
                 then conversation.participant_two
               else conversation.participant_one
             end as id
    ) as other_user
    left join public.profiles as other_profile on other_profile.id = other_user.id
    left join public.students as other_student on other_student.auth_user_id = other_user.id
    left join lateral (
      select message.content, message.created_at
        from public.collaborative_study_direct_messages as message
       where message.conversation_id = conversation.id
       order by message.created_at desc
       limit 1
    ) as latest_message on true
   where auth.uid() in (conversation.participant_one, conversation.participant_two)
   order by coalesce(latest_message.created_at, conversation.created_at) desc;
end;
$$;

create or replace function public.start_collaborative_study_direct_conversation(
  p_other_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  conversation_id uuid;
begin
  if actor_id is null or p_other_user_id is null or actor_id = p_other_user_id then
    raise exception 'Choose another signed-in member to start a chat.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.collaborative_study_team_members as current_member
      join public.collaborative_study_team_members as other_member
        on other_member.team_id = current_member.team_id
     where current_member.user_id = actor_id
       and current_member.invitation_status = 'accepted'
       and other_member.user_id = p_other_user_id
       and other_member.invitation_status = 'accepted'
  ) then
    raise exception 'Direct chats are available only with people in your teams.'
      using errcode = '42501';
  end if;

  first_user := least(actor_id, p_other_user_id);
  second_user := greatest(actor_id, p_other_user_id);

  insert into public.collaborative_study_direct_conversations (
    participant_one, participant_two, created_by
  )
  values (first_user, second_user, actor_id)
  on conflict (participant_one, participant_two) do nothing;

  select conversation.id
    into conversation_id
    from public.collaborative_study_direct_conversations as conversation
   where conversation.participant_one = first_user
     and conversation.participant_two = second_user;

  return conversation_id;
end;
$$;

create or replace function public.send_collaborative_study_team_message(
  p_team_id uuid,
  p_content text,
  p_attachment_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  message_id uuid;
  message_content text;
begin
  if actor_id is null
     or not public.is_collaborative_study_team_member(p_team_id) then
    raise exception 'Accept the team invitation before sending messages.'
      using errcode = '42501';
  end if;

  message_content := coalesce(nullif(btrim(p_content), ''), 'Voice note');
  if length(message_content) > 4000 then
    raise exception 'Messages must be 4000 characters or fewer.';
  end if;

  if p_attachment_path is not null and (
    p_attachment_path not like p_team_id::text || '/' || actor_id::text || '/%'
    or not exists (
      select 1 from storage.objects as object
       where object.bucket_id = 'study-team-resources'
         and object.name = p_attachment_path
    )
  ) then
    raise exception 'The uploaded voice note could not be verified.'
      using errcode = '42501';
  end if;

  select coalesce(
           nullif(btrim(profile.display_name), ''),
           nullif(btrim(student.display_name), ''),
           nullif(btrim(profile.full_name), ''),
           nullif(btrim(student.full_name), ''),
           'Team member'
         )
    into actor_name
    from public.profiles as profile
    left join public.students as student on student.auth_user_id = profile.id
   where profile.id = actor_id;

  insert into public.collaborative_study_team_messages (
    team_id, sender_id, sender_name, content, attachment_path, attachment_type
  )
  values (
    p_team_id, actor_id, coalesce(actor_name, 'Team member'), message_content,
    p_attachment_path, case when p_attachment_path is null then null else 'audio' end
  )
  returning id into message_id;

  return message_id;
end;
$$;

create or replace function public.send_collaborative_study_direct_message(
  p_conversation_id uuid,
  p_content text,
  p_attachment_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  message_id uuid;
  message_content text;
begin
  if actor_id is null or not exists (
    select 1
      from public.collaborative_study_direct_conversations as conversation
     where conversation.id = p_conversation_id
       and actor_id in (conversation.participant_one, conversation.participant_two)
  ) then
    raise exception 'You are not a participant in this direct chat.'
      using errcode = '42501';
  end if;

  message_content := coalesce(nullif(btrim(p_content), ''), 'Voice note');
  if length(message_content) > 4000 then
    raise exception 'Messages must be 4000 characters or fewer.';
  end if;

  if p_attachment_path is not null and (
    p_attachment_path not like 'direct/' || p_conversation_id::text || '/' || actor_id::text || '/%'
    or not exists (
      select 1 from storage.objects as object
       where object.bucket_id = 'study-team-resources'
         and object.name = p_attachment_path
    )
  ) then
    raise exception 'The uploaded voice note could not be verified.'
      using errcode = '42501';
  end if;

  actor_name := public.get_collaborative_study_my_display_name();

  insert into public.collaborative_study_direct_messages (
    conversation_id, sender_id, sender_name, content, attachment_path, attachment_type
  )
  values (
    p_conversation_id, actor_id, coalesce(actor_name, 'Team member'), message_content,
    p_attachment_path, case when p_attachment_path is null then null else 'audio' end
  )
  returning id into message_id;

  return message_id;
end;
$$;

revoke all on function public.get_collaborative_study_team_members(uuid)
  from public, anon;
grant execute on function public.get_collaborative_study_team_members(uuid)
  to authenticated;
revoke all on function public.get_collaborative_study_my_display_name()
  from public, anon;
grant execute on function public.get_collaborative_study_my_display_name()
  to authenticated;
revoke all on function public.get_collaborative_study_direct_conversations()
  from public, anon;
grant execute on function public.get_collaborative_study_direct_conversations()
  to authenticated;
revoke all on function public.start_collaborative_study_direct_conversation(uuid)
  from public, anon;
grant execute on function public.start_collaborative_study_direct_conversation(uuid)
  to authenticated;
revoke all on function public.send_collaborative_study_team_message(uuid, text, text)
  from public, anon;
grant execute on function public.send_collaborative_study_team_message(uuid, text, text)
  to authenticated;
revoke all on function public.send_collaborative_study_direct_message(uuid, text, text)
  from public, anon;
grant execute on function public.send_collaborative_study_direct_message(uuid, text, text)
  to authenticated;

update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/plain',
         'image/jpeg',
         'image/png',
         'image/webp',
         'audio/webm',
         'audio/ogg',
         'audio/mp4',
         'audio/mpeg',
         'audio/wav'
       ]
 where id = 'study-team-resources';

drop policy if exists collaborative_study_resources_storage_read
  on storage.objects;
create policy collaborative_study_resources_storage_read
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'study-team-resources'
    and (
      (
        (storage.foldername(storage.objects.name))[1] = 'direct'
        and exists (
          select 1
            from public.collaborative_study_direct_conversations as conversation
           where conversation.id::text = (storage.foldername(storage.objects.name))[2]
             and auth.uid() in (conversation.participant_one, conversation.participant_two)
        )
      )
      or exists (
        select 1
          from public.collaborative_study_teams as team
         where team.id::text = (storage.foldername(storage.objects.name))[1]
           and public.is_collaborative_study_team_member(team.id)
      )
    )
  );

drop policy if exists collaborative_study_resources_storage_insert
  on storage.objects;
create policy collaborative_study_resources_storage_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'study-team-resources'
    and (
      (
        (storage.foldername(storage.objects.name))[1] = 'direct'
        and (storage.foldername(storage.objects.name))[3] = auth.uid()::text
        and exists (
          select 1
            from public.collaborative_study_direct_conversations as conversation
           where conversation.id::text = (storage.foldername(storage.objects.name))[2]
             and auth.uid() in (conversation.participant_one, conversation.participant_two)
        )
      )
      or (
        (storage.foldername(storage.objects.name))[2] = auth.uid()::text
        and exists (
          select 1
            from public.collaborative_study_teams as team
           where team.id::text = (storage.foldername(storage.objects.name))[1]
             and public.is_collaborative_study_team_member(team.id)
        )
      )
    )
  );

drop policy if exists collaborative_study_resources_storage_delete
  on storage.objects;
create policy collaborative_study_resources_storage_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'study-team-resources'
    and (
      (
        (storage.foldername(storage.objects.name))[1] = 'direct'
        and (storage.foldername(storage.objects.name))[3] = auth.uid()::text
        and exists (
          select 1
            from public.collaborative_study_direct_conversations as conversation
           where conversation.id::text = (storage.foldername(storage.objects.name))[2]
             and auth.uid() in (conversation.participant_one, conversation.participant_two)
        )
      )
      or (
        (storage.foldername(storage.objects.name))[2] = auth.uid()::text
        and exists (
          select 1
            from public.collaborative_study_teams as team
           where team.id::text = (storage.foldername(storage.objects.name))[1]
             and public.is_collaborative_study_team_member(team.id)
        )
      )
    )
  );

drop policy if exists collaborative_study_team_realtime_read
  on realtime.messages;
create policy collaborative_study_team_realtime_read
  on realtime.messages
  for select to authenticated
  using (
    (
      realtime.topic() ~ '^study-team:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_collaborative_study_team_member(
        split_part(realtime.topic(), ':', 2)::uuid
      )
    )
    or (
      realtime.topic() ~ '^study-direct:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1
          from public.collaborative_study_direct_conversations as conversation
         where conversation.id::text = split_part(realtime.topic(), ':', 2)
           and auth.uid() in (conversation.participant_one, conversation.participant_two)
      )
    )
  );

drop policy if exists collaborative_study_team_realtime_write
  on realtime.messages;
create policy collaborative_study_team_realtime_write
  on realtime.messages
  for insert to authenticated
  with check (
    (
      realtime.topic() ~ '^study-team:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_collaborative_study_team_member(
        split_part(realtime.topic(), ':', 2)::uuid
      )
    )
    or (
      realtime.topic() ~ '^study-direct:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1
          from public.collaborative_study_direct_conversations as conversation
         where conversation.id::text = split_part(realtime.topic(), ':', 2)
           and auth.uid() in (conversation.participant_one, conversation.participant_two)
      )
    )
  );

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
      from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'collaborative_study_direct_messages'
  ) then
    alter publication supabase_realtime
      add table public.collaborative_study_direct_messages;
  end if;
end;
$$;
