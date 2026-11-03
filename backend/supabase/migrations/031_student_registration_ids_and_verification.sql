create table if not exists public.student_registration_counters (
  counter_key text primary key,
  last_number bigint not null check (last_number >= 0)
);

insert into public.student_registration_counters (counter_key, last_number)
select 'global', count(*)
  from public.students
on conflict (counter_key) do nothing;

with region_codes (region_name, region_code) as (
  values
    ('Ahafo', 'AH'),
    ('Ashanti', 'AS'),
    ('Bono', 'BO'),
    ('Bono East', 'BE'),
    ('Central', 'CE'),
    ('Eastern', 'EA'),
    ('Greater Accra', 'GA'),
    ('North East', 'NE'),
    ('Northern', 'NO'),
    ('Oti', 'OT'),
    ('Savannah', 'SA'),
    ('Upper East', 'UE'),
    ('Upper West', 'UW'),
    ('Volta', 'VO'),
    ('Western', 'WE'),
    ('Western North', 'WN')
)
insert into public.student_registration_counters (counter_key, last_number)
select
  'region:' || region_codes.region_code,
  count(students.id)
from region_codes
left join public.students
  on lower(trim(students.region)) = lower(region_codes.region_name)
group by region_codes.region_code
on conflict (counter_key) do nothing;

revoke all on public.student_registration_counters from public, anon, authenticated;

create or replace function public.allocate_student_registration_id(p_region text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  region_code text;
  region_number bigint;
  global_number bigint;
  registration_date date := (clock_timestamp() at time zone 'Africa/Accra')::date;
begin
  region_code := case lower(trim(p_region))
    when 'ahafo' then 'AH'
    when 'ashanti' then 'AS'
    when 'bono' then 'BO'
    when 'bono east' then 'BE'
    when 'central' then 'CE'
    when 'eastern' then 'EA'
    when 'greater accra' then 'GA'
    when 'north east' then 'NE'
    when 'northern' then 'NO'
    when 'oti' then 'OT'
    when 'savannah' then 'SA'
    when 'upper east' then 'UE'
    when 'upper west' then 'UW'
    when 'volta' then 'VO'
    when 'western' then 'WE'
    when 'western north' then 'WN'
    else null
  end;

  if region_code is null then
    raise exception 'A valid Ghana region is required to allocate a Student ID.';
  end if;

  update public.student_registration_counters
     set last_number = last_number + 1
   where counter_key = 'global'
   returning last_number into global_number;

  if global_number is null then
    raise exception 'The global student registration counter is not initialized.';
  end if;

  insert into public.student_registration_counters as existing_counter (counter_key, last_number)
  values ('region:' || region_code, 1)
  on conflict (counter_key) do update
    set last_number = existing_counter.last_number + 1
  returning last_number into region_number;

  return 'CG-' || region_code ||
    case when region_number < 10 then '0' || region_number::text else region_number::text end ||
    to_char(registration_date, 'MMYY') ||
    case when global_number < 100 then lpad(global_number::text, 3, '0') else global_number::text end;
end;
$$;

revoke all on function public.allocate_student_registration_id(text) from public, anon, authenticated;
grant execute on function public.allocate_student_registration_id(text) to service_role;

create table if not exists public.student_notifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists student_notifications_student_created_idx
  on public.student_notifications (student_id, created_at desc);

alter table public.student_notifications enable row level security;
revoke all on public.student_notifications from public, anon;
grant select, update (is_read) on public.student_notifications to authenticated;
grant all on public.student_notifications to service_role;

drop policy if exists student_notifications_select_own on public.student_notifications;
create policy student_notifications_select_own
  on public.student_notifications
  for select to authenticated
  using (student_id = public.current_student_record_id());

drop policy if exists student_notifications_update_own on public.student_notifications;
create policy student_notifications_update_own
  on public.student_notifications
  for update to authenticated
  using (student_id = public.current_student_record_id())
  with check (student_id = public.current_student_record_id());

create or replace function public.notify_student_profile_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(new.status, '')) = 'confirmed'
     and (
       tg_op = 'INSERT'
       or lower(coalesce(old.status, '')) <> 'confirmed'
     ) then
    insert into public.student_notifications (
      student_id,
      notification_type,
      title,
      message
    )
    values (
      new.id,
      'profile_confirmed',
      'Student profile confirmed',
      'Your Campus Ghana student profile has been confirmed. A verified badge will now appear beside your name.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists student_profile_confirmation_notification on public.students;
create trigger student_profile_confirmation_notification
  after insert or update of status on public.students
  for each row
  execute function public.notify_student_profile_confirmed();

do $$
begin
  if exists (
    select 1
      from pg_publication
     where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'student_notifications'
  ) then
    alter publication supabase_realtime add table public.student_notifications;
  end if;
end;
$$;
