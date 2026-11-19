create or replace function public.course_discussion_parent_is_valid(
  p_parent_id uuid,
  p_course_id uuid,
  p_lesson_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.course_discussions parent
    where parent.id = p_parent_id
      and parent.course_id = p_course_id
      and parent.lesson_id = p_lesson_id
      and parent.parent_id is null
      and parent.is_hidden = false
  );
$$;

revoke all on function public.course_discussion_parent_is_valid(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.course_discussion_parent_is_valid(uuid, uuid, text)
  to authenticated;

drop policy if exists "Enrolled students and course staff can post discussions"
  on public.course_discussions;
create policy "Enrolled students and course staff can post discussions"
  on public.course_discussions for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1
      from public.courses
      join lateral jsonb_array_elements(courses.lessons) as lesson(value) on true
      where courses.id = course_discussions.course_id
        and lesson.value->>'id' = course_discussions.lesson_id
        and (
          courses.is_published = true
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
          )
        )
    )
    and (
      exists (
        select 1 from public.profiles
        where profiles.id = auth.uid()
          and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
      )
      or (
        exists (
          select 1 from public.course_enrollments enrollment
          where enrollment.course_id = course_discussions.course_id
            and enrollment.student_id = public.current_student_record_id()
        )
        and (
          parent_id is null
          or public.course_discussion_parent_is_valid(
            course_discussions.parent_id,
            course_discussions.course_id,
            course_discussions.lesson_id
          )
        )
      )
    )
  );

notify pgrst, 'reload schema';
