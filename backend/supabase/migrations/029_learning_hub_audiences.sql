-- Organize published learning materials for JHS, SHS, and university learners.
alter table public.study_content
  add column if not exists education_level text not null default 'all',
  add column if not exists resource_kind text not null default 'lesson_notes';

alter table public.study_content
  drop constraint if exists study_content_education_level_check,
  add constraint study_content_education_level_check
    check (education_level in ('all', 'jhs', 'shs', 'university')),
  drop constraint if exists study_content_resource_kind_check,
  add constraint study_content_resource_kind_check
    check (resource_kind in (
      'lesson_notes',
      'past_questions',
      'course_materials',
      'study_guides',
      'practice'
    ));

create index if not exists study_content_audience_kind_idx
  on public.study_content (education_level, resource_kind, is_published);
