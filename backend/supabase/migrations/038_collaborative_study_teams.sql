alter table public.students
  add column if not exists deleted_at timestamptz;

create table if not exists public.collaborative_study_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 3 and 100),
  description text not null default '' check (length(description) <= 1000),
  education_level text not null
    check (education_level in ('JHS', 'SHS', 'University', 'Other')),
  class_level text not null check (length(btrim(class_level)) between 1 and 80),
  subject text not null check (length(btrim(subject)) between 1 and 100),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_by_role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collaborative_study_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.collaborative_study_teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null,
  display_name text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  invitation_status text not null default 'pending'
    check (invitation_status in ('pending', 'accepted', 'declined')),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (team_id, user_id)
);

create table if not exists public.collaborative_study_team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.collaborative_study_teams (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_name text not null,
  content text not null check (length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.collaborative_study_team_resources (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.collaborative_study_teams (id) on delete cascade,
  shared_by uuid not null references auth.users (id) on delete cascade,
  shared_by_name text not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  resource_type text not null check (resource_type in ('link', 'file')),
  resource_url text,
  storage_path text,
  created_at timestamptz not null default now(),
  constraint collaborative_study_team_resource_target check (
    (resource_type = 'link' and resource_url is not null and storage_path is null)
    or (resource_type = 'file' and resource_url is null and storage_path is not null)
  )
);

create index if not exists collaborative_study_teams_context_idx
  on public.collaborative_study_teams (education_level, class_level, subject);
create index if not exists collaborative_study_teams_creator_idx
  on public.collaborative_study_teams (created_by, created_at desc);
create index if not exists collaborative_study_team_members_user_idx
  on public.collaborative_study_team_members (user_id, invitation_status);
create index if not exists collaborative_study_team_messages_team_idx
  on public.collaborative_study_team_messages (team_id, created_at);
create index if not exists collaborative_study_team_resources_team_idx
  on public.collaborative_study_team_resources (team_id, created_at desc);

alter table public.collaborative_study_teams enable row level security;
alter table public.collaborative_study_team_members enable row level security;
alter table public.collaborative_study_team_messages enable row level security;
alter table public.collaborative_study_team_resources enable row level security;

create or replace function public.is_collaborative_study_team_member(
  p_team_id uuid,
  p_accepted_only boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.collaborative_study_team_members as member
     where member.team_id = p_team_id
       and member.user_id = auth.uid()
       and (not p_accepted_only or member.invitation_status = 'accepted')
  );
$$;

revoke all on function public.is_collaborative_study_team_member(uuid, boolean)
  from public, anon;
grant execute on function public.is_collaborative_study_team_member(uuid, boolean)
  to authenticated;

drop policy if exists collaborative_study_teams_read
  on public.collaborative_study_teams;
create policy collaborative_study_teams_read
  on public.collaborative_study_teams
  for select to authenticated
  using (public.is_collaborative_study_team_member(id, false));

drop policy if exists collaborative_study_team_members_read
  on public.collaborative_study_team_members;
create policy collaborative_study_team_members_read
  on public.collaborative_study_team_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_collaborative_study_team_member(team_id)
  );

drop policy if exists collaborative_study_team_messages_read
  on public.collaborative_study_team_messages;
create policy collaborative_study_team_messages_read
  on public.collaborative_study_team_messages
  for select to authenticated
  using (public.is_collaborative_study_team_member(team_id));

drop policy if exists collaborative_study_team_messages_insert
  on public.collaborative_study_team_messages;
create policy collaborative_study_team_messages_insert
  on public.collaborative_study_team_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_collaborative_study_team_member(team_id)
  );

drop policy if exists collaborative_study_team_resources_read
  on public.collaborative_study_team_resources;
create policy collaborative_study_team_resources_read
  on public.collaborative_study_team_resources
  for select to authenticated
  using (public.is_collaborative_study_team_member(team_id));

drop policy if exists collaborative_study_team_resources_insert
  on public.collaborative_study_team_resources;
create policy collaborative_study_team_resources_insert
  on public.collaborative_study_team_resources
  for insert to authenticated
  with check (
    shared_by = auth.uid()
    and public.is_collaborative_study_team_member(team_id)
  );

revoke all on public.collaborative_study_teams from public, anon, authenticated;
revoke all on public.collaborative_study_team_members from public, anon, authenticated;
revoke all on public.collaborative_study_team_messages from public, anon, authenticated;
revoke all on public.collaborative_study_team_resources from public, anon, authenticated;
grant select on public.collaborative_study_teams to authenticated;
grant select on public.collaborative_study_team_members to authenticated;
grant select, insert on public.collaborative_study_team_messages to authenticated;
grant select, insert on public.collaborative_study_team_resources to authenticated;

create or replace function public.education_level_for_class(p_class text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_class, '')) ~ '(jhs|junior|basic)' then 'JHS'
    when lower(coalesce(p_class, '')) ~ '(shs|senior)' then 'SHS'
    when lower(coalesce(p_class, '')) ~ '(university|tertiary|college|level[[:space:]]*[1-9])' then 'University'
    else 'Other'
  end;
$$;

create or replace function public.create_collaborative_study_team(
  p_name text,
  p_description text,
  p_education_level text,
  p_class_level text,
  p_subject text,
  p_invited_emails text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  actor_name text;
  actor_class text;
  new_team_id uuid;
  invite_email text;
  invite_user_id uuid;
  invite_role text;
  invite_name text;
  invited_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Sign in to create a study team.' using errcode = '42501';
  end if;

  select lower(role), coalesce(nullif(btrim(full_name), ''), 'Campus Ghana member')
    into actor_role, actor_name
    from public.profiles
   where id = actor_id;

  if actor_role is null or actor_role not in ('student', 'admin', 'school_admin', 'teacher', 'staff') then
    raise exception 'This account cannot create study teams.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_name, ''))) not between 3 and 100
     or length(coalesce(p_description, '')) > 1000
     or p_education_level not in ('JHS', 'SHS', 'University', 'Other')
     or length(btrim(coalesce(p_class_level, ''))) not between 1 and 80
     or length(btrim(coalesce(p_subject, ''))) not between 1 and 100 then
    raise exception 'Enter a valid team name, education level, class, and subject.';
  end if;

  if coalesce(cardinality(p_invited_emails), 0) > 20 then
    raise exception 'A study team can invite up to 20 participants at a time.';
  end if;

  if actor_role = 'student' then
    select class
      into actor_class
      from public.students
     where auth_user_id = actor_id
       and deleted_at is null
     limit 1;
    if actor_class is null
       or lower(btrim(actor_class)) <> lower(btrim(p_class_level))
       or public.education_level_for_class(actor_class) <> p_education_level then
      raise exception 'Student teams must match your current education level and class.';
    end if;
  end if;

  insert into public.collaborative_study_teams (
    name, description, education_level, class_level, subject, created_by, created_by_role
  )
  values (
    btrim(p_name), btrim(coalesce(p_description, '')), p_education_level,
    btrim(p_class_level), btrim(p_subject), actor_id, actor_role
  )
  returning id into new_team_id;

  insert into public.collaborative_study_team_members (
    team_id, user_id, role_key, display_name, invited_by, invitation_status, responded_at
  )
  values (
    new_team_id, actor_id, actor_role, actor_name, actor_id, 'accepted', now()
  );

  foreach invite_email in array coalesce(p_invited_emails, '{}') loop
    invite_email := lower(btrim(invite_email));
    if invite_email = '' then
      continue;
    end if;
    if invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'One of the invitation email addresses is invalid.';
    end if;
    if invited_count >= 20 then
      raise exception 'A study team can invite up to 20 participants at a time.';
    end if;

    select users.id,
           lower(profiles.role),
           coalesce(nullif(btrim(profiles.full_name), ''), invite_email)
      into invite_user_id, invite_role, invite_name
      from auth.users as users
      join public.profiles as profiles on profiles.id = users.id
     where lower(users.email) = invite_email
     limit 1;

    if invite_user_id is null then
      raise exception 'No active Campus Ghana account was found for %.', invite_email;
    end if;
    if invite_user_id = actor_id then
      raise exception 'You cannot invite yourself.';
    end if;
    insert into public.collaborative_study_team_members (
      team_id, user_id, role_key, display_name, invited_by, invitation_status
    )
    values (
      new_team_id, invite_user_id, invite_role, invite_name, actor_id, 'pending'
    )
    on conflict (team_id, user_id) do update
      set role_key = excluded.role_key,
          display_name = excluded.display_name,
          invited_by = excluded.invited_by,
          invitation_status = 'pending',
          invited_at = now(),
          responded_at = null
      where public.collaborative_study_team_members.invitation_status = 'declined';

    invited_count := invited_count + 1;
  end loop;

  return new_team_id;
end;
$$;

create or replace function public.respond_to_collaborative_study_team_invitation(
  p_membership_id uuid,
  p_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_response not in ('accepted', 'declined') then
    raise exception 'Choose whether to accept or decline this invitation.'
      using errcode = '42501';
  end if;

  update public.collaborative_study_team_members
     set invitation_status = p_response,
         responded_at = now()
   where id = p_membership_id
     and user_id = auth.uid()
     and invitation_status = 'pending';

  if not found then
    raise exception 'This invitation is no longer available.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.education_level_for_class(text) from public, anon;
grant execute on function public.education_level_for_class(text) to authenticated;
revoke all on function public.create_collaborative_study_team(text, text, text, text, text, text[])
  from public, anon;
grant execute on function public.create_collaborative_study_team(text, text, text, text, text, text[])
  to authenticated;
revoke all on function public.respond_to_collaborative_study_team_invitation(uuid, text)
  from public, anon;
grant execute on function public.respond_to_collaborative_study_team_invitation(uuid, text)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'study-team-resources',
  'study-team-resources',
  false,
  20971520,
  array[
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
    'image/webp'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

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
