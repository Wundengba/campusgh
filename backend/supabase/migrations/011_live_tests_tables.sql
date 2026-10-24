-- LIVE TESTS TABLES
-- Create tables for live testing functionality

-- Live tests table
create table if not exists public.live_tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  subject text,
  class text,
  test_type text not null default 'mixed' check (test_type in ('multiple_choice', 'true_false', 'short_answer', 'fill_in', 'long_text', 'mixed')),
  duration_minutes integer not null default 30,
  total_questions integer not null default 0,
  is_active boolean not null default false,
  start_time timestamptz,
  end_time timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Test questions table
create table if not exists public.test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.live_tests(id) on delete cascade,
  question_text text not null,
  question_type text not null default 'multiple_choice' check (question_type in ('multiple_choice', 'true_false', 'short_answer', 'fill_in', 'long_text')),
  points integer not null default 1,
  correct_answer text, -- For multiple choice: option index, for true_false: 'true'/'false', for short_answer/fill_in: the answer, for long_text: rubric or keywords
  explanation text, -- Optional explanation for correct answer
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

-- Test answers/options table (for multiple choice questions)
create table if not exists public.test_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.test_questions(id) on delete cascade,
  answer_text text not null,
  is_correct boolean not null default false,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

-- Student test sessions table
create table if not exists public.student_test_sessions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.live_tests(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  time_remaining_seconds integer,
  score integer default 0,
  max_score integer default 0,
  is_completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Student answers table
create table if not exists public.student_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.student_test_sessions(id) on delete cascade,
  question_id uuid not null references public.test_questions(id) on delete cascade,
  answer_text text, -- For multiple choice: answer id, for short answer: text response
  is_correct boolean default false,
  points_earned integer default 0,
  answered_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists live_tests_created_by_idx on public.live_tests (created_by);
create index if not exists live_tests_is_active_idx on public.live_tests (is_active);
create index if not exists test_questions_test_id_idx on public.test_questions (test_id);
create index if not exists test_answers_question_id_idx on public.test_answers (question_id);
create index if not exists student_test_sessions_test_id_idx on public.student_test_sessions (test_id);
create index if not exists student_test_sessions_student_id_idx on public.student_test_sessions (student_id);
create index if not exists student_answers_session_id_idx on public.student_answers (session_id);

-- Row Level Security policies
alter table public.live_tests enable row level security;
alter table public.test_questions enable row level security;
alter table public.test_answers enable row level security;
alter table public.student_test_sessions enable row level security;
alter table public.student_answers enable row level security;

-- Policies for live_tests
create policy "Admins can manage live tests" on public.live_tests
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  );

create policy "Students can view active tests" on public.live_tests
  for select using (is_active = true);

-- Policies for test_questions
create policy "Admins can manage test questions" on public.test_questions
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  );

create policy "Students can view questions for active tests" on public.test_questions
  for select using (
    exists (
      select 1 from public.live_tests
      where live_tests.id = test_questions.test_id
      and live_tests.is_active = true
    )
  );

-- Policies for test_answers
create policy "Admins can manage test answers" on public.test_answers
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  );

create policy "Students can view answers for active tests" on public.test_answers
  for select using (
    exists (
      select 1 from public.live_tests lt
      join public.test_questions tq on lt.id = tq.test_id
      where tq.id = test_answers.question_id
      and lt.is_active = true
    )
  );

-- Policies for student_test_sessions
create policy "Students can manage their own test sessions" on public.student_test_sessions
  for all using (
    exists (
      select 1 from public.students
      where students.id = student_test_sessions.student_id
      and students.user_id = auth.uid()
    )
  );

create policy "Admins can view all test sessions" on public.student_test_sessions
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  );

-- Policies for student_answers
create policy "Students can manage their own answers" on public.student_answers
  for all using (
    exists (
      select 1 from public.student_test_sessions sts
      join public.students s on sts.student_id = s.id
      where sts.id = student_answers.session_id
      and s.user_id = auth.uid()
    )
  );

create policy "Admins can view all student answers" on public.student_answers
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  );