alter table public.course_quiz_attempts
  add column if not exists attempt_type text not null default 'initial';

alter table public.course_quiz_attempts
  add column if not exists resit_of_attempt_id uuid
  references public.course_quiz_attempts(id) on delete cascade;

alter table public.course_quiz_attempts
  add constraint course_quiz_attempts_resit_shape_check
  check (
    attempt_type in ('initial', 'resit')
    and (
      (attempt_type = 'initial' and resit_of_attempt_id is null)
      or (attempt_type = 'resit' and resit_of_attempt_id is not null)
    )
  );

create unique index if not exists course_quiz_attempts_one_resit_per_initial_idx
  on public.course_quiz_attempts (resit_of_attempt_id)
  where resit_of_attempt_id is not null;

drop policy if exists "Students can save their course quiz attempts"
  on public.course_quiz_attempts;
create policy "Students can save their course quiz attempts"
  on public.course_quiz_attempts
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
    and (
      (attempt_type = 'initial' and resit_of_attempt_id is null)
      or (
        attempt_type = 'resit'
        and exists (
          select 1
          from public.course_quiz_attempts initial_attempt
          where initial_attempt.id = course_quiz_attempts.resit_of_attempt_id
            and initial_attempt.attempt_type = 'initial'
            and initial_attempt.student_id = course_quiz_attempts.student_id
            and initial_attempt.enrollment_id = course_quiz_attempts.enrollment_id
            and initial_attempt.course_id = course_quiz_attempts.course_id
            and initial_attempt.lesson_id = course_quiz_attempts.lesson_id
            and course_quiz_attempts.total_questions <= initial_attempt.total_questions
        )
      )
    )
  );

notify pgrst, 'reload schema';
