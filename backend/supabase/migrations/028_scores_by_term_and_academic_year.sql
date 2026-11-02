update public.scores
   set term = coalesce(nullif(btrim(term), ''), 'Unspecified Term'),
       academic_year = coalesce(
         nullif(btrim(academic_year), ''),
         'Unspecified Academic Year'
       )
 where term is null
    or btrim(term) = ''
    or academic_year is null
    or btrim(academic_year) = '';

alter table public.scores
  alter column term set default 'Unspecified Term',
  alter column term set not null,
  alter column academic_year set default 'Unspecified Academic Year',
  alter column academic_year set not null;

drop index if exists public.scores_student_subject_exam_uidx;

create unique index if not exists scores_student_subject_exam_period_uidx
  on public.scores (
    student_id,
    subject,
    exam_type,
    academic_year,
    term
  );
