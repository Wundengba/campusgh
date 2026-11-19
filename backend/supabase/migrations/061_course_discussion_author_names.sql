create or replace function public.get_course_discussion_author_names(
  p_course_id uuid,
  p_author_ids uuid[]
)
returns table (author_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  course_staff boolean;
  course_member boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view course discussion authors.'
      using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
  ) into course_staff;

  select exists (
    select 1
    from public.course_enrollments
    where course_id = p_course_id
      and student_id = public.current_student_record_id()
  ) into course_member;

  if not course_staff and not course_member then
    raise exception 'You must be enrolled in this course to view discussion authors.'
      using errcode = '42501';
  end if;

  if cardinality(coalesce(p_author_ids, '{}'::uuid[])) > 500 then
    raise exception 'Too many discussion authors were requested.'
      using errcode = '22023';
  end if;

  return query
  select author_row.id,
         coalesce(
           nullif(btrim(profile.display_name), ''),
           nullif(btrim(student.display_name), ''),
           nullif(btrim(profile.full_name), ''),
           nullif(btrim(student.full_name), ''),
           case when author_row.id = auth.uid() then 'You' else 'Course member' end
         )
    from (
      select distinct discussion.author_id as id
      from public.course_discussions discussion
      where discussion.course_id = p_course_id
        and discussion.author_id = any(coalesce(p_author_ids, '{}'::uuid[]))
        and (
          course_staff
          or (
            not discussion.is_hidden
            and (
              discussion.parent_id is null
              or exists (
                select 1
                from public.course_discussions parent
                where parent.id = discussion.parent_id
                  and parent.course_id = discussion.course_id
                  and not parent.is_hidden
              )
            )
          )
        )
    ) author_row
    left join public.profiles profile on profile.id = author_row.id
    left join public.students student on student.auth_user_id = author_row.id;
end;
$$;

revoke all on function public.get_course_discussion_author_names(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.get_course_discussion_author_names(uuid, uuid[])
  to authenticated;

notify pgrst, 'reload schema';
