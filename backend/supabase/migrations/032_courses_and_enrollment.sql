create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  subject text not null default '',
  education_level text not null default 'all'
    check (education_level in ('all', 'jhs', 'shs', 'university')),
  lessons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lessons) = 'array'),
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists courses_published_level_idx
  on public.courses (is_published, education_level);

create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (course_id, student_id)
);

create index if not exists course_enrollments_student_idx
  on public.course_enrollments (student_id, enrolled_at desc);

create table if not exists public.course_lesson_progress (
  enrollment_id uuid not null references public.course_enrollments(id) on delete cascade,
  lesson_id text not null,
  completed_at timestamptz not null default now(),
  primary key (enrollment_id, lesson_id)
);

revoke all on public.courses, public.course_enrollments, public.course_lesson_progress
  from public, anon;
grant select, insert, update, delete on public.courses to authenticated;
grant select, insert on public.course_enrollments to authenticated;
grant select, insert, delete on public.course_lesson_progress to authenticated;

alter table public.courses enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.course_lesson_progress enable row level security;

drop policy if exists "Admins can manage courses" on public.courses;
create policy "Admins can manage courses" on public.courses
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
    )
  );

drop policy if exists "Students can view published courses" on public.courses;
create policy "Students can view published courses" on public.courses
  for select to authenticated
  using (is_published = true);

drop policy if exists "Students can view their course enrollments" on public.course_enrollments;
create policy "Students can view their course enrollments" on public.course_enrollments
  for select to authenticated
  using (
    student_id = public.current_student_record_id()
  );

drop policy if exists "Students can enroll in published courses" on public.course_enrollments;
create policy "Students can enroll in published courses" on public.course_enrollments
  for insert to authenticated
  with check (
    student_id = public.current_student_record_id()
    and exists (
      select 1 from public.courses
      where courses.id = course_enrollments.course_id
        and courses.is_published = true
    )
  );

drop policy if exists "Admins can view course enrollments" on public.course_enrollments;
create policy "Admins can view course enrollments" on public.course_enrollments
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
    )
  );

drop policy if exists "Students can view their lesson progress" on public.course_lesson_progress;
create policy "Students can view their lesson progress" on public.course_lesson_progress
  for select to authenticated
  using (
    exists (
      select 1 from public.course_enrollments enrollment
      where enrollment.id = course_lesson_progress.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
    )
  );

drop policy if exists "Students can track their lesson progress" on public.course_lesson_progress;
create policy "Students can track their lesson progress" on public.course_lesson_progress
  for insert to authenticated
  with check (
    exists (
      select 1 from public.course_enrollments enrollment
      join public.courses on courses.id = enrollment.course_id
      where enrollment.id = course_lesson_progress.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
        and courses.is_published = true
    )
  );

drop policy if exists "Students can reset their lesson progress" on public.course_lesson_progress;
create policy "Students can reset their lesson progress" on public.course_lesson_progress
  for delete to authenticated
  using (
    exists (
      select 1 from public.course_enrollments enrollment
      where enrollment.id = course_lesson_progress.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
    )
  );
