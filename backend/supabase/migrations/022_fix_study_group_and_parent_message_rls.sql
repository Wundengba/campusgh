-- Break study-group RLS recursion by checking membership through a
-- SECURITY DEFINER helper that only evaluates the current user's membership.
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
      and member.student_id = auth.uid()
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
      and study_group.created_by = auth.uid()
  ) or public.is_current_user_study_group_member(p_group_id, 'admin');
$$;

revoke all on function public.is_current_user_study_group_member(uuid, text) from public;
revoke all on function public.can_manage_study_group(uuid) from public;
grant execute on function public.is_current_user_study_group_member(uuid, text) to anon, authenticated;
grant execute on function public.can_manage_study_group(uuid) to anon, authenticated;

drop policy if exists "Students can view public groups and their own groups" on public.study_groups;
create policy "Students can view public groups and their own groups"
on public.study_groups
for select
using (
  not is_private
  or created_by = auth.uid()
  or public.is_current_user_study_group_member(id)
);

drop policy if exists "Students can create groups" on public.study_groups;
create policy "Students can create groups"
on public.study_groups
for insert
to authenticated
with check (auth.uid() = created_by);

drop policy if exists "Group admins can update their groups" on public.study_groups;
create policy "Group admins can update their groups"
on public.study_groups
for update
using (public.can_manage_study_group(id))
with check (public.can_manage_study_group(id));

drop policy if exists "Members can view their group memberships" on public.study_group_members;
create policy "Members can view their group memberships"
on public.study_group_members
for select
using (
  student_id = auth.uid()
  or public.can_manage_study_group(group_id)
);

drop policy if exists "Group admins can manage members" on public.study_group_members;
create policy "Group admins can manage members"
on public.study_group_members
for all
using (public.can_manage_study_group(group_id))
with check (public.can_manage_study_group(group_id));

-- Use the authenticated JWT email rather than querying auth.users from RLS.
drop policy if exists "Teachers can view and respond to parent messages" on public.parent_teacher_messages;
create policy "Teachers can view and respond to parent messages"
on public.parent_teacher_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.teachers
    where teachers.id = parent_teacher_messages.teacher_id
      and lower(teachers.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

drop policy if exists "Teachers can send messages to parents" on public.parent_teacher_messages;
create policy "Teachers can send messages to parents"
on public.parent_teacher_messages
for insert
to authenticated
with check (
  is_from_parent = false
  and exists (
    select 1
    from public.teachers
    where teachers.id = parent_teacher_messages.teacher_id
      and lower(teachers.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);
