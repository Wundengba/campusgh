create table if not exists public.student_profile_portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal_title text not null default ''
    check (char_length(goal_title) <= 120),
  goal_type text not null default 'chapters'
    check (goal_type in ('cgpa', 'chapters', 'courses')),
  goal_target numeric(6, 2),
  goal_due_date date,
  skills text[] not null default '{}'
    check (cardinality(skills) <= 8),
  projects jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(projects) = 'array'
      and case
        when jsonb_typeof(projects) = 'array' then jsonb_array_length(projects) <= 5
        else false
      end
    ),
  share_goal boolean not null default false,
  share_skills boolean not null default false,
  share_projects boolean not null default false,
  share_achievements boolean not null default false,
  share_institution boolean not null default false,
  share_education_level boolean not null default false,
  share_public boolean not null default false,
  updated_at timestamptz not null default now(),
  check (
    goal_target is null
    or (
      goal_type = 'cgpa'
      and goal_target between 0.01 and 4.00
    )
    or (
      goal_type in ('chapters', 'courses')
      and goal_target between 1 and 1000
      and floor(goal_target) = goal_target
    )
  )
);

alter table public.student_profile_portfolios enable row level security;
revoke all on public.student_profile_portfolios from public, anon, authenticated;
grant select, insert, update, delete on public.student_profile_portfolios to authenticated;

drop policy if exists "Students manage their own profile portfolio"
  on public.student_profile_portfolios;
create policy "Students manage their own profile portfolio"
  on public.student_profile_portfolios for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.set_student_profile_portfolio_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_student_profile_portfolio_updated_at()
  from public, anon, authenticated;

drop trigger if exists student_profile_portfolio_updated_at
  on public.student_profile_portfolios;
create trigger student_profile_portfolio_updated_at
  before update on public.student_profile_portfolios
  for each row
  execute function public.set_student_profile_portfolio_updated_at();

do $$
begin
  if to_regclass('public.campus_social_profiles') is not null then
    execute 'revoke select on public.campus_social_profiles from public, anon, authenticated';
    execute 'grant select (
      user_id,
      display_name,
      username,
      name_tags,
      display_name_changed_at,
      username_changed_at,
      bio,
      avatar_url,
      discoverable
    ) on public.campus_social_profiles to authenticated';
  end if;
end;
$$;

create or replace function public.get_student_profile_portfolio(p_user_id uuid)
returns table (
  user_id uuid,
  goal_title text,
  goal_type text,
  goal_target numeric,
  goal_due_date date,
  institution text,
  education_level text,
  skills text[],
  projects jsonb,
  achievements jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or to_regclass('public.campus_social_profiles') is null then
    return;
  end if;

  return query execute $portfolio_query$
  select portfolio.user_id,
         case when portfolio.share_goal
           then nullif(btrim(portfolio.goal_title), '')
           else null
         end,
         case when portfolio.share_goal then portfolio.goal_type else null end,
         case when portfolio.share_goal then portfolio.goal_target else null end,
         case when portfolio.share_goal then portfolio.goal_due_date else null end,
         case when portfolio.share_institution
           then nullif(btrim(student.institution), '')
           else null
         end,
         case when portfolio.share_education_level
           then nullif(btrim(student.class), '')
           else null
         end,
         case when portfolio.share_skills then portfolio.skills else '{}'::text[] end,
         case when portfolio.share_projects then portfolio.projects else '[]'::jsonb end,
         case when portfolio.share_achievements then coalesce((
           select jsonb_agg(
             jsonb_build_object(
               'course_title', course.title,
               'completed_chapters', progress.completed_chapters,
               'total_chapters', lesson_totals.total_chapters,
               'certificate_issued_at', certificate.issued_at
             )
             order by enrollment.enrolled_at desc
           )
           from public.course_enrollments enrollment
           join public.courses course on course.id = enrollment.course_id
           cross join lateral (
             select count(*)::integer as total_chapters
             from jsonb_array_elements(course.lessons) as lesson(value)
             where nullif(lesson.value->>'id', '') is not null
           ) lesson_totals
           left join lateral (
             select count(distinct progress.lesson_id)::integer as completed_chapters
             from public.course_lesson_progress progress
             join lateral jsonb_array_elements(course.lessons) as lesson(value)
               on lesson.value->>'id' = progress.lesson_id
             where progress.enrollment_id = enrollment.id
               and progress.quiz_passed = true
           ) progress on true
           left join public.course_certificates certificate
             on certificate.enrollment_id = enrollment.id
           where enrollment.student_id = (
             select student.id
             from public.students student
             where student.auth_user_id = portfolio.user_id
             limit 1
           )
         ), '[]'::jsonb) else '[]'::jsonb end
    from public.student_profile_portfolios portfolio
    left join lateral (
      select student.institution, student.class
      from public.students student
      where student.auth_user_id = portfolio.user_id
      limit 1
    ) student on true
   where portfolio.user_id = $1
     and portfolio.share_public = true
     and exists (
       select 1
       from public.campus_social_profiles social_profile
       where social_profile.user_id = portfolio.user_id
         and social_profile.discoverable = true
     )
  $portfolio_query$ using p_user_id;
end;
$$;

revoke all on function public.get_student_profile_portfolio(uuid)
  from public, anon, authenticated;
grant execute on function public.get_student_profile_portfolio(uuid)
  to authenticated;

notify pgrst, 'reload schema';
