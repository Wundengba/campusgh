alter table public.students
  add column if not exists auth_user_id uuid references auth.users (id) on delete set null;

alter table public.student_study_progress
  add column if not exists chapter_index integer;

alter table public.student_study_progress
  add column if not exists completed boolean not null default false;

alter table public.student_study_progress
  add column if not exists chapter_key integer
    generated always as (coalesce(chapter_index, -1)) stored;

alter table public.student_study_progress
  drop constraint if exists student_study_progress_student_id_content_id_key;

create unique index if not exists student_study_progress_student_content_chapter_uidx
  on public.student_study_progress (student_id, content_id, chapter_key);

do $$
begin
  if exists (
    select 1
      from public.scores
     where student_id is not null
     group by student_id, subject, exam_type
    having count(*) > 1
  ) then
    raise exception 'Resolve duplicate scores for the same student, subject, and exam type before applying migration 023.';
  end if;
end;
$$;

create unique index if not exists scores_student_subject_exam_uidx
  on public.scores (student_id, subject, exam_type);

create unique index if not exists students_auth_user_id_uidx
  on public.students (auth_user_id)
  where auth_user_id is not null;

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from public, anon;
grant select, insert, update on public.user_preferences to authenticated;
drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own on public.user_preferences
  for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.normalize_ghana_phone(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  with phone_digits as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as value
  )
  select case
    when value ~ '^0[0-9]{9}$' then '233' || substr(value, 2)
    when value ~ '^233[0-9]{9}$' then value
    else null
  end
  from phone_digits;
$$;

create or replace function public.link_student_auth_user(p_student_index text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := auth.uid();
  verified_phone text := public.normalize_ghana_phone(auth.jwt() ->> 'phone');
  student_row public.students%rowtype;
  affected_rows integer;
begin
  if actor_id is null or verified_phone is null then
    raise exception 'A verified Ghanaian phone number is required.'
      using errcode = '42501';
  end if;

  select *
    into student_row
    from public.students
   where (index_number = p_student_index or "index" = p_student_index)
     and public.normalize_ghana_phone(parent_contact) = verified_phone
   limit 1;

  if student_row.id is null then
    raise exception 'Student ID and verified guardian phone do not match school records.'
      using errcode = '42501';
  end if;

  if student_row.auth_user_id is not null and student_row.auth_user_id <> actor_id then
    raise exception 'This student record is already linked to another account.'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.profiles
     where id = actor_id and role <> 'student'
  ) then
    raise exception 'This account is not eligible for student access.'
      using errcode = '42501';
  end if;

  update public.students
     set auth_user_id = actor_id
   where id = student_row.id;

  insert into public.profiles (id, email, full_name, role)
  values (
    actor_id,
    auth.jwt() ->> 'email',
    coalesce(student_row.full_name, ''),
    'student'
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name)
    where public.profiles.role = 'student';

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    raise exception 'This account is not eligible for student access.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'student_id', student_row.id,
    'index', coalesce(student_row.index_number, student_row."index"),
    'full_name', student_row.full_name
  );
end;
$$;

revoke all on function public.link_student_auth_user(text) from public, anon;
grant execute on function public.link_student_auth_user(text) to authenticated;

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
   limit 1;
$$;

revoke all on function public.current_student_record_id() from public, anon;
grant execute on function public.current_student_record_id() to authenticated;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles
     where id = auth.uid()
       and role = 'admin'
  );
$$;

revoke all on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

alter table public.profiles enable row level security;
drop policy if exists profiles_public_access on public.profiles;
drop policy if exists profiles_authenticated_select_own on public.profiles;
drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_authenticated_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());
create policy profiles_admin_manage on public.profiles
  for all to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

alter table public.students enable row level security;
drop policy if exists students_public_access on public.students;
drop policy if exists students_authenticated_select_own on public.students;
drop policy if exists students_staff_manage on public.students;
create policy students_authenticated_select_own on public.students
  for select to authenticated
  using (auth_user_id = auth.uid());

create policy students_staff_manage on public.students
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = auth.uid()
         and role in ('admin', 'teacher', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
       where id = auth.uid()
         and role in ('admin', 'teacher', 'staff')
    )
  );

drop policy if exists "Students can manage their own progress" on public.student_study_progress;
create policy "Students can manage their own progress" on public.student_study_progress
  for all to authenticated
  using (student_id = public.current_student_record_id())
  with check (student_id = public.current_student_record_id());

drop policy if exists "Students can manage their own attempts" on public.student_question_attempts;
create policy "Students can manage their own attempts" on public.student_question_attempts
  for all to authenticated
  using (student_id = public.current_student_record_id())
  with check (student_id = public.current_student_record_id());

create or replace function public.is_current_user_study_group_member(
  p_group_id uuid,
  p_required_role text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.study_group_members as member
     where member.group_id = p_group_id
       and member.student_id = public.current_student_record_id()
       and (p_required_role is null or member.role = p_required_role)
  );
$$;

create or replace function public.can_manage_study_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.study_groups as study_group
     where study_group.id = p_group_id
       and study_group.created_by = coalesce(
         public.current_student_record_id(),
         auth.uid()
       )
  ) or public.is_current_user_study_group_member(p_group_id, 'admin');
$$;

revoke all on function public.is_current_user_study_group_member(uuid, text) from public, anon;
revoke all on function public.can_manage_study_group(uuid) from public, anon;
grant execute on function public.is_current_user_study_group_member(uuid, text) to authenticated;
grant execute on function public.can_manage_study_group(uuid) to authenticated;

drop policy if exists "Students can view public groups and their own groups" on public.study_groups;
create policy "Students can view public groups and their own groups" on public.study_groups
  for select to authenticated
  using (
    not is_private
    or created_by = coalesce(public.current_student_record_id(), auth.uid())
    or public.is_current_user_study_group_member(id)
  );

drop policy if exists "Students can create groups" on public.study_groups;
create policy "Students can create groups" on public.study_groups
  for insert to authenticated
  with check (
    created_by = coalesce(public.current_student_record_id(), auth.uid())
  );

drop policy if exists "Group admins can update their groups" on public.study_groups;
create policy "Group admins can update their groups" on public.study_groups
  for update to authenticated
  using (public.can_manage_study_group(id))
  with check (public.can_manage_study_group(id));

drop policy if exists "Members can view their group memberships" on public.study_group_members;
create policy "Members can view their group memberships" on public.study_group_members
  for select to authenticated
  using (
    student_id = public.current_student_record_id()
    or public.can_manage_study_group(group_id)
  );

drop policy if exists "Group admins can manage members" on public.study_group_members;
create policy "Group admins can manage members" on public.study_group_members
  for all to authenticated
  using (public.can_manage_study_group(group_id))
  with check (public.can_manage_study_group(group_id));

drop policy if exists "Group members can view messages" on public.study_group_messages;
create policy "Group members can view messages" on public.study_group_messages
  for select to authenticated
  using (public.is_current_user_study_group_member(group_id));

drop policy if exists "Group members can send messages" on public.study_group_messages;
create policy "Group members can send messages" on public.study_group_messages
  for insert to authenticated
  with check (
    student_id = public.current_student_record_id()
    and public.is_current_user_study_group_member(group_id)
  );

drop policy if exists "Group members can view sessions" on public.study_group_sessions;
create policy "Group members can view sessions" on public.study_group_sessions
  for select to authenticated
  using (public.is_current_user_study_group_member(group_id));

drop policy if exists "Group members can create sessions" on public.study_group_sessions;
create policy "Group members can create sessions" on public.study_group_sessions
  for insert to authenticated
  with check (
    created_by = coalesce(public.current_student_record_id(), auth.uid())
    and public.is_current_user_study_group_member(group_id)
  );

drop policy if exists "Session participants can view participation" on public.study_session_participants;
create policy "Session participants can view participation" on public.study_session_participants
  for select to authenticated
  using (student_id = public.current_student_record_id());

drop policy if exists "Students can update their participation status" on public.study_session_participants;
create policy "Students can update their participation status" on public.study_session_participants
  for all to authenticated
  using (student_id = public.current_student_record_id())
  with check (student_id = public.current_student_record_id());

drop policy if exists "Students can view their achievements" on public.study_group_achievements;
create policy "Students can view their achievements" on public.study_group_achievements
  for select to authenticated
  using (student_id = public.current_student_record_id());
