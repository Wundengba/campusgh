do $$
declare
  has_users boolean;
  has_profiles boolean;
begin
  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'users'
  ) into has_users;

  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'profiles'
  ) into has_profiles;

  if not has_users and not has_profiles then
    raise notice 'Skipping teacher scope backfill because public.users and public.profiles are unavailable.';
    return;
  end if;

  execute format(
    $sql$
      with teacher_email_scope as (
        select
          email_key,
          min(registered_school_id) as registered_school_id
        from (
          %1$s
        ) as scoped_accounts
        group by email_key
        having count(distinct registered_school_id) = 1
      )
      update public.teachers as t
      set registered_school_id = teacher_email_scope.registered_school_id
      from teacher_email_scope
      where t.registered_school_id is null
        and t.email is not null
        and btrim(t.email) <> ''
        and lower(btrim(t.email)) = teacher_email_scope.email_key
    $sql$,
    array_to_string(
      array_remove(
        array[
          case
            when has_users then
              'select lower(btrim(email)) as email_key, registered_school_id from public.users where email is not null and btrim(email) <> '''' and registered_school_id is not null'
            else null
          end,
          case
            when has_profiles then
              'select lower(btrim(email)) as email_key, registered_school_id from public.profiles where email is not null and btrim(email) <> '''' and registered_school_id is not null'
            else null
          end
        ],
        null
      ),
      ' union all '
    )
  );
end
$$;

create index if not exists teachers_email_idx on public.teachers (email);
