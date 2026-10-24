-- STUDY CONTENT TABLES
-- Create tables for study content and learning materials

-- Study content table (lessons, articles, etc.)
create table if not exists public.study_content (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  content_type text not null default 'lesson' check (content_type in ('lesson', 'article', 'video', 'document', 'interactive')),
  subject text,
  class_level text,
  content text, -- Main content (HTML/markdown)
  tags text[], -- Array of tags for categorization
  difficulty_level text default 'intermediate' check (difficulty_level in ('beginner', 'intermediate', 'advanced')),
  estimated_read_time integer, -- in minutes
  is_published boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Study questions table (practice questions)
create table if not exists public.study_questions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.study_content(id) on delete cascade,
  question_text text not null,
  question_type text not null default 'multiple_choice' check (question_type in ('multiple_choice', 'true_false', 'short_answer', 'essay')),
  points integer not null default 1,
  correct_answer text, -- For multiple choice: option index, for true_false: 'true'/'false', for others: expected answer
  explanation text, -- Optional explanation for correct answer
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

-- Study answers/options table (for multiple choice questions)
create table if not exists public.study_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.study_questions(id) on delete cascade,
  answer_text text not null,
  is_correct boolean not null default false,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

-- Student study progress table
create table if not exists public.student_study_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  content_id uuid not null references public.study_content(id) on delete cascade,
  progress_percentage integer not null default 0 check (progress_percentage >= 0 and progress_percentage <= 100),
  time_spent_minutes integer not null default 0,
  completed_at timestamptz,
  last_accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(student_id, content_id)
);

-- Student question attempts table
create table if not exists public.student_question_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  question_id uuid not null references public.study_questions(id) on delete cascade,
  answer_text text, -- Student's answer
  is_correct boolean default false,
  points_earned integer default 0,
  attempted_at timestamptz not null default now(),
  unique(student_id, question_id)
);

-- Indexes for performance
create index if not exists study_content_created_by_idx on public.study_content (created_by);
create index if not exists study_content_subject_idx on public.study_content (subject);
create index if not exists study_content_class_level_idx on public.study_content (class_level);
create index if not exists study_content_is_published_idx on public.study_content (is_published);
create index if not exists study_questions_content_id_idx on public.study_questions (content_id);
create index if not exists study_answers_question_id_idx on public.study_answers (question_id);
create index if not exists student_study_progress_student_id_idx on public.student_study_progress (student_id);
create index if not exists student_study_progress_content_id_idx on public.student_study_progress (content_id);
create index if not exists student_question_attempts_student_id_idx on public.student_question_attempts (student_id);
create index if not exists student_question_attempts_question_id_idx on public.student_question_attempts (question_id);

-- Row Level Security policies
alter table public.study_content enable row level security;
alter table public.study_questions enable row level security;
alter table public.study_answers enable row level security;
alter table public.student_study_progress enable row level security;
alter table public.student_question_attempts enable row level security;

-- Policies for study_content
drop policy if exists "Admins can manage study content" on public.study_content;
drop policy if exists "Students can view published content" on public.study_content;

create policy "Admins can manage study content" on public.study_content
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
    )
  );

create policy "Students can view published content" on public.study_content
  for select using (is_published = true);

-- Policies for study_questions
drop policy if exists "Admins and teachers can manage study questions" on public.study_questions;
drop policy if exists "Students can view questions for published content" on public.study_questions;

create policy "Admins and teachers can manage study questions" on public.study_questions
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
    )
  );

create policy "Students can view questions for published content" on public.study_questions
  for select using (
    exists (
      select 1 from public.study_content
      where study_content.id = study_questions.content_id
      and study_content.is_published = true
    )
  );

-- Policies for study_answers
drop policy if exists "Admins and teachers can manage study answers" on public.study_answers;
drop policy if exists "Students can view answers for published content" on public.study_answers;

create policy "Admins and teachers can manage study answers" on public.study_answers
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin', 'school_admin', 'teacher')
    )
  );

create policy "Students can view answers for published content" on public.study_answers
  for select using (
    exists (
      select 1 from public.study_questions q
      join public.study_content c on q.content_id = c.id
      where q.id = study_answers.question_id
      and c.is_published = true
    )
  );

-- Policies for student_study_progress
drop policy if exists "Students can manage their own progress" on public.student_study_progress;
drop policy if exists "Teachers and admins can view all progress" on public.student_study_progress;

create policy "Students can manage their own progress" on public.student_study_progress
  for all using (
    student_id in (
      select id from public.students
      where students.user_id = auth.uid()
    )
  );

create policy "Teachers and admins can view all progress" on public.student_study_progress
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin', 'teacher')
    )
  );

-- Policies for student_question_attempts
drop policy if exists "Students can manage their own attempts" on public.student_question_attempts;
drop policy if exists "Teachers and admins can view all attempts" on public.student_question_attempts;

create policy "Students can manage their own attempts" on public.student_question_attempts
  for all using (
    student_id in (
      select id from public.students
      where students.user_id = auth.uid()
    )
  );

create policy "Teachers and admins can view all attempts" on public.student_question_attempts
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin', 'teacher')
    )
  );