-- Add chapter mapping to study questions and chapter-level student progress
alter table if exists public.study_questions add column if not exists chapter_index integer not null default 0;

alter table if exists public.student_study_progress add column if not exists chapter_index integer not null default 0;

alter table if exists public.student_study_progress drop constraint if exists student_study_progress_student_id_content_id_key;
create unique index if not exists student_study_progress_student_content_chapter_uq on public.student_study_progress (student_id, content_id, chapter_index);

create index if not exists student_study_progress_chapter_index_idx on public.student_study_progress (chapter_index);
