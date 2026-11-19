alter table public.course_lesson_progress
  add column if not exists quiz_passed boolean not null default false;

grant update on public.course_lesson_progress to authenticated;

drop policy if exists "Students can track their lesson progress" on public.course_lesson_progress;
create policy "Students can track their lesson progress" on public.course_lesson_progress
  for insert to authenticated
  with check (
    quiz_passed = true
    and exists (
      select 1
      from public.course_enrollments enrollment
      join public.courses on courses.id = enrollment.course_id
      where enrollment.id = course_lesson_progress.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
        and courses.is_published = true
    )
  );

drop policy if exists "Students can update their quiz-passed lesson progress" on public.course_lesson_progress;
create policy "Students can update their quiz-passed lesson progress" on public.course_lesson_progress
  for update to authenticated
  using (
    exists (
      select 1
      from public.course_enrollments enrollment
      where enrollment.id = course_lesson_progress.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
    )
  )
  with check (
    quiz_passed = true
    and exists (
      select 1
      from public.course_enrollments enrollment
      join public.courses on courses.id = enrollment.course_id
      where enrollment.id = course_lesson_progress.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
        and courses.is_published = true
    )
  );

create table if not exists public.course_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  enrollment_id uuid not null references public.course_enrollments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id text not null,
  course_title text not null,
  lesson_title text not null,
  correct_count integer not null check (correct_count >= 0),
  total_questions integer not null check (total_questions > 0),
  percentage integer not null check (percentage between 0 and 100),
  created_at timestamptz not null default now(),
  check (correct_count <= total_questions)
);

create index if not exists course_quiz_attempts_student_created_idx
  on public.course_quiz_attempts (student_id, created_at desc);

revoke all on public.course_quiz_attempts from public, anon;
grant select, insert on public.course_quiz_attempts to authenticated;

alter table public.course_quiz_attempts enable row level security;

drop policy if exists "Students can view their course quiz attempts" on public.course_quiz_attempts;
create policy "Students can view their course quiz attempts" on public.course_quiz_attempts
  for select to authenticated
  using (student_id = public.current_student_record_id());

drop policy if exists "Students can save their course quiz attempts" on public.course_quiz_attempts;
create policy "Students can save their course quiz attempts" on public.course_quiz_attempts
  for insert to authenticated
  with check (
    student_id = public.current_student_record_id()
    and exists (
      select 1
      from public.course_enrollments enrollment
      join public.courses on courses.id = enrollment.course_id
      where enrollment.id = course_quiz_attempts.enrollment_id
        and enrollment.course_id = course_quiz_attempts.course_id
        and enrollment.student_id = course_quiz_attempts.student_id
        and courses.is_published = true
    )
  );

notify pgrst, 'reload schema';
