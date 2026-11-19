alter table public.courses
  add column if not exists due_at timestamptz,
  add column if not exists prerequisites uuid[] not null default '{}';

create or replace function public.enforce_course_enrollment_prerequisites()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prerequisite_course_id uuid;
  prerequisite_lesson_count integer;
  completed_lesson_count integer;
begin
  for prerequisite_course_id in
    select unnest(courses.prerequisites)
    from public.courses
    where courses.id = new.course_id
  loop
    select count(*) into prerequisite_lesson_count
    from public.courses prerequisite_course
    cross join lateral jsonb_array_elements(prerequisite_course.lessons) as lesson(value)
    where prerequisite_course.id = prerequisite_course_id
      and nullif(lesson.value->>'id', '') is not null;

    select count(distinct progress.lesson_id) into completed_lesson_count
    from public.course_enrollments prerequisite_enrollment
    join public.course_lesson_progress progress
      on progress.enrollment_id = prerequisite_enrollment.id
    join public.courses prerequisite_course
      on prerequisite_course.id = prerequisite_course_id
    cross join lateral jsonb_array_elements(prerequisite_course.lessons) as lesson(value)
    where prerequisite_enrollment.student_id = new.student_id
      and prerequisite_enrollment.course_id = prerequisite_course_id
      and progress.quiz_passed = true
      and lesson.value->>'id' = progress.lesson_id;

    if prerequisite_lesson_count = 0
      or completed_lesson_count < prerequisite_lesson_count then
      raise exception 'Complete all prerequisite courses before enrolling.'
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.enforce_course_enrollment_prerequisites()
  from public, anon, authenticated;

drop trigger if exists enforce_course_enrollment_prerequisites
  on public.course_enrollments;
create trigger enforce_course_enrollment_prerequisites
  before insert on public.course_enrollments
  for each row
  execute function public.enforce_course_enrollment_prerequisites();

drop policy if exists "Course staff can view course enrollments"
  on public.course_enrollments;
create policy "Course staff can view course enrollments"
  on public.course_enrollments for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
    )
  );

create table if not exists public.course_learning_state (
  enrollment_id uuid primary key
    references public.course_enrollments(id) on delete cascade,
  last_lesson_id text,
  updated_at timestamptz not null default now()
);

alter table public.course_learning_state enable row level security;
revoke all on public.course_learning_state from public, anon;
grant select, insert, update, delete on public.course_learning_state to authenticated;

drop policy if exists "Students can view their course learning state"
  on public.course_learning_state;
create policy "Students can view their course learning state"
  on public.course_learning_state for select to authenticated
  using (
    exists (
      select 1 from public.course_enrollments enrollment
      where enrollment.id = course_learning_state.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
    )
  );

drop policy if exists "Students can manage their course learning state"
  on public.course_learning_state;
create policy "Students can manage their course learning state"
  on public.course_learning_state for all to authenticated
  using (
    exists (
      select 1 from public.course_enrollments enrollment
      where enrollment.id = course_learning_state.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
    )
  )
  with check (
    exists (
      select 1 from public.course_enrollments enrollment
      where enrollment.id = course_learning_state.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
    )
  );

create table if not exists public.course_lesson_notes (
  enrollment_id uuid not null
    references public.course_enrollments(id) on delete cascade,
  lesson_id text not null,
  note text not null default '' check (char_length(note) <= 5000),
  bookmarked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, lesson_id)
);

alter table public.course_lesson_notes enable row level security;
revoke all on public.course_lesson_notes from public, anon;
grant select, insert, update, delete on public.course_lesson_notes to authenticated;

drop policy if exists "Students can manage their course lesson notes"
  on public.course_lesson_notes;
create policy "Students can manage their course lesson notes"
  on public.course_lesson_notes for all to authenticated
  using (
    exists (
      select 1 from public.course_enrollments enrollment
      where enrollment.id = course_lesson_notes.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
    )
  )
  with check (
    exists (
      select 1 from public.course_enrollments enrollment
      join public.courses on courses.id = enrollment.course_id
      where enrollment.id = course_lesson_notes.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
        and courses.is_published = true
    )
  );

create table if not exists public.course_certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique
    references public.course_enrollments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  course_title text not null,
  issued_at timestamptz not null default now()
);

create index if not exists course_certificates_student_issued_idx
  on public.course_certificates (student_id, issued_at desc);

alter table public.course_certificates enable row level security;
revoke all on public.course_certificates from public, anon, authenticated;
grant select on public.course_certificates to authenticated;

drop policy if exists "Students can view their course certificates"
  on public.course_certificates;
create policy "Students can view their course certificates"
  on public.course_certificates for select to authenticated
  using (student_id = public.current_student_record_id());

drop policy if exists "Course staff can view course certificates"
  on public.course_certificates;
create policy "Course staff can view course certificates"
  on public.course_certificates for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
    )
  );

create or replace function public.issue_course_completion_certificate(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  enrollment_row public.course_enrollments%rowtype;
  course_row public.courses%rowtype;
  total_lessons integer;
  completed_lessons integer;
begin
  select * into enrollment_row
  from public.course_enrollments
  where id = p_enrollment_id;

  if not found then
    return;
  end if;

  select * into course_row
  from public.courses
  where id = enrollment_row.course_id;

  if not found then
    return;
  end if;

  select count(*) into total_lessons
  from jsonb_array_elements(course_row.lessons) as lesson(value)
  where nullif(lesson.value->>'id', '') is not null;

  if total_lessons = 0 then
    return;
  end if;

  select count(distinct progress.lesson_id) into completed_lessons
  from public.course_lesson_progress progress
  join lateral jsonb_array_elements(course_row.lessons) as lesson(value)
    on lesson.value->>'id' = progress.lesson_id
  where progress.enrollment_id = p_enrollment_id
    and progress.quiz_passed = true;

  if completed_lessons = total_lessons then
    insert into public.course_certificates (
      enrollment_id, student_id, course_id, course_title
    )
    values (
      enrollment_row.id, enrollment_row.student_id, course_row.id, course_row.title
    )
    on conflict (enrollment_id) do nothing;
  end if;
end;
$$;

revoke all on function public.issue_course_completion_certificate(uuid)
  from public, anon, authenticated;

create or replace function public.issue_course_completion_certificate_after_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.quiz_passed then
    perform public.issue_course_completion_certificate(new.enrollment_id);
  end if;
  return new;
end;
$$;

revoke all on function public.issue_course_completion_certificate_after_progress()
  from public, anon, authenticated;

drop trigger if exists course_completion_certificate_after_progress
  on public.course_lesson_progress;
create trigger course_completion_certificate_after_progress
  after insert or update of quiz_passed on public.course_lesson_progress
  for each row
  execute function public.issue_course_completion_certificate_after_progress();

do $$
declare
  enrollment_record record;
begin
  for enrollment_record in
    select id from public.course_enrollments
  loop
    perform public.issue_course_completion_certificate(enrollment_record.id);
  end loop;
end;
$$;

create table if not exists public.course_discussions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id text not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.course_discussions(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create index if not exists course_discussions_lesson_created_idx
  on public.course_discussions (course_id, lesson_id, created_at);

alter table public.course_discussions enable row level security;
revoke all on public.course_discussions from public, anon, authenticated;
grant select, insert, update (is_hidden) on public.course_discussions to authenticated;

drop policy if exists "Course members can view visible discussions"
  on public.course_discussions;
create policy "Course members can view visible discussions"
  on public.course_discussions for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
    )
    or (
      not is_hidden
      and exists (
        select 1 from public.course_enrollments enrollment
        where enrollment.course_id = course_discussions.course_id
          and enrollment.student_id = public.current_student_record_id()
      )
    )
  );

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

drop policy if exists "Course staff can moderate discussions"
  on public.course_discussions;
create policy "Course staff can moderate discussions"
  on public.course_discussions for update to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
    )
  );

drop policy if exists "Course staff can view all lesson progress"
  on public.course_lesson_progress;
create policy "Course staff can view all lesson progress"
  on public.course_lesson_progress for select to authenticated
  using (
    exists (
      select 1
      from public.course_enrollments enrollment
      join public.profiles on profiles.id = auth.uid()
      where enrollment.id = course_lesson_progress.enrollment_id
        and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
    )
  );

drop policy if exists "Course staff can view all quiz attempts"
  on public.course_quiz_attempts;
create policy "Course staff can view all quiz attempts"
  on public.course_quiz_attempts for select to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
    )
  );

notify pgrst, 'reload schema';
