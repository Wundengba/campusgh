alter table public.students add column if not exists registered_school_id bigint references public.registered_schools (id) on delete set null;
alter table public.teachers add column if not exists registered_school_id bigint references public.registered_schools (id) on delete set null;
alter table public.attendance add column if not exists registered_school_id bigint references public.registered_schools (id) on delete set null;
alter table public.fees add column if not exists registered_school_id bigint references public.registered_schools (id) on delete set null;
alter table public.scores add column if not exists registered_school_id bigint references public.registered_schools (id) on delete set null;
alter table public.results add column if not exists registered_school_id bigint references public.registered_schools (id) on delete set null;
alter table public.events add column if not exists registered_school_id bigint references public.registered_schools (id) on delete set null;
alter table public.chat_messages add column if not exists registered_school_id bigint references public.registered_schools (id) on delete set null;

create index if not exists students_registered_school_id_idx on public.students (registered_school_id);
create index if not exists teachers_registered_school_id_idx on public.teachers (registered_school_id);
create index if not exists attendance_registered_school_id_idx on public.attendance (registered_school_id);
create index if not exists fees_registered_school_id_idx on public.fees (registered_school_id);
create index if not exists scores_registered_school_id_idx on public.scores (registered_school_id);
create index if not exists results_registered_school_id_idx on public.results (registered_school_id);
create index if not exists events_registered_school_id_idx on public.events (registered_school_id);
create index if not exists chat_messages_registered_school_id_idx on public.chat_messages (registered_school_id);

update public.students as s
set registered_school_id = u.registered_school_id
from public.users as u
where s.user_id = u.id
  and s.registered_school_id is null
  and u.registered_school_id is not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'index'
  ) then
    execute $sql$
      update public.attendance as a
      set registered_school_id = s.registered_school_id
      from public.students as s
      where a.registered_school_id is null
        and s.registered_school_id is not null
        and (
          a.student_id = s.id
          or (a.student_id is null and a.index_number is not null and a.index_number in (s.index_number, s."index"))
        )
    $sql$;
  else
    update public.attendance as a
    set registered_school_id = s.registered_school_id
    from public.students as s
    where a.registered_school_id is null
      and s.registered_school_id is not null
      and (
        a.student_id = s.id
        or (a.student_id is null and a.index_number is not null and a.index_number = s.index_number)
      );
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'index'
  ) then
    execute $sql$
      update public.fees as f
      set registered_school_id = s.registered_school_id
      from public.students as s
      where f.registered_school_id is null
        and s.registered_school_id is not null
        and (
          f.student_id = s.id
          or (f.student_id is null and f.index_number is not null and f.index_number in (s.index_number, s."index"))
        )
    $sql$;
  else
    update public.fees as f
    set registered_school_id = s.registered_school_id
    from public.students as s
    where f.registered_school_id is null
      and s.registered_school_id is not null
      and (
        f.student_id = s.id
        or (f.student_id is null and f.index_number is not null and f.index_number = s.index_number)
      );
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'index'
  ) then
    execute $sql$
      update public.scores as sc
      set registered_school_id = s.registered_school_id
      from public.students as s
      where sc.registered_school_id is null
        and s.registered_school_id is not null
        and (
          sc.student_id = s.id
          or (sc.student_id is null and sc.index_number is not null and sc.index_number in (s.index_number, s."index"))
        )
    $sql$;
  else
    update public.scores as sc
    set registered_school_id = s.registered_school_id
    from public.students as s
    where sc.registered_school_id is null
      and s.registered_school_id is not null
      and (
        sc.student_id = s.id
        or (sc.student_id is null and sc.index_number is not null and sc.index_number = s.index_number)
      );
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'index'
  ) then
    execute $sql$
      update public.results as r
      set registered_school_id = s.registered_school_id
      from public.students as s
      where r.registered_school_id is null
        and s.registered_school_id is not null
        and (
          r.student_id = s.id
          or (r.student_id is null and r.index_number is not null and r.index_number in (s.index_number, s."index"))
        )
    $sql$;
  else
    update public.results as r
    set registered_school_id = s.registered_school_id
    from public.students as s
    where r.registered_school_id is null
      and s.registered_school_id is not null
      and (
        r.student_id = s.id
        or (r.student_id is null and r.index_number is not null and r.index_number = s.index_number)
      );
  end if;
end
$$;