create table if not exists public.course_checkpoint_progress (
  enrollment_id uuid primary key
    references public.course_enrollments(id) on delete cascade,
  completed_percent integer not null default 0
    check (completed_percent in (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100)),
  updated_at timestamptz not null default now()
);

insert into public.course_checkpoint_progress (enrollment_id, completed_percent)
select enrollment.id, 0
from public.course_enrollments enrollment
on conflict (enrollment_id) do nothing;

alter table public.course_checkpoint_progress enable row level security;
revoke all on public.course_checkpoint_progress from public, anon, authenticated;
grant select on public.course_checkpoint_progress to authenticated;
grant all on public.course_checkpoint_progress to service_role;

drop policy if exists "Students can view their course checkpoint progress"
  on public.course_checkpoint_progress;
create policy "Students can view their course checkpoint progress"
  on public.course_checkpoint_progress
  for select to authenticated
  using (
    exists (
      select 1
      from public.course_enrollments enrollment
      where enrollment.id = course_checkpoint_progress.enrollment_id
        and enrollment.student_id = public.current_student_record_id()
    )
  );

create table if not exists public.course_checkpoint_quizzes (
  enrollment_id uuid not null
    references public.course_enrollments(id) on delete cascade,
  checkpoint_percent integer not null
    check (checkpoint_percent in (10, 20, 30, 40, 50, 60, 70, 80, 90, 100)),
  questions jsonb not null
    check (jsonb_typeof(questions) = 'array'),
  score_percent integer
    check (score_percent is null or score_percent between 0 and 100),
  passed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, checkpoint_percent)
);

alter table public.course_checkpoint_quizzes enable row level security;
revoke all on public.course_checkpoint_quizzes from public, anon, authenticated;
grant all on public.course_checkpoint_quizzes to service_role;
