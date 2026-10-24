-- Add chapters support to study content
alter table if exists public.study_content add column if not exists chapters jsonb not null default '[]'::jsonb;
