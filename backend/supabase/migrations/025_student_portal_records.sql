create table if not exists public.student_portal_records (
  student_id uuid not null references public.students (id) on delete cascade,
  record_type text not null check (
    record_type in (
      'study_plan',
      'payment_notice',
      'payment_plan',
      'attendance_correction',
      'support_ticket',
      'student_goal',
      'student_document',
      'assignment_status',
      'announcement_read'
    )
  ),
  record_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, record_type, record_key)
);

create index if not exists student_portal_records_type_updated_idx
  on public.student_portal_records (record_type, updated_at desc);

drop trigger if exists set_student_portal_records_updated_at
  on public.student_portal_records;
create trigger set_student_portal_records_updated_at
before update on public.student_portal_records
for each row execute function public.set_row_updated_at();

alter table public.student_portal_records enable row level security;
revoke all on public.student_portal_records from public, anon;
grant select, insert, update, delete on public.student_portal_records to authenticated;

drop policy if exists student_portal_records_select_own
  on public.student_portal_records;
create policy student_portal_records_select_own
on public.student_portal_records
for select to authenticated
using (student_id = public.current_student_record_id());

drop policy if exists student_portal_records_insert_own
  on public.student_portal_records;
create policy student_portal_records_insert_own
on public.student_portal_records
for insert to authenticated
with check (student_id = public.current_student_record_id());

drop policy if exists student_portal_records_update_own
  on public.student_portal_records;
create policy student_portal_records_update_own
on public.student_portal_records
for update to authenticated
using (student_id = public.current_student_record_id())
with check (student_id = public.current_student_record_id());

drop policy if exists student_portal_records_delete_own
  on public.student_portal_records;
create policy student_portal_records_delete_own
on public.student_portal_records
for delete to authenticated
using (student_id = public.current_student_record_id());

drop policy if exists student_portal_records_admin_manage
  on public.student_portal_records;
create policy student_portal_records_admin_manage
on public.student_portal_records
for all to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

alter table public.fees enable row level security;
drop policy if exists fees_public_access on public.fees;
drop policy if exists fees_students_select_own on public.fees;
drop policy if exists fees_staff_manage on public.fees;
drop policy if exists fees_admin_manage on public.fees;
drop policy if exists fees_school_admin_manage on public.fees;
create policy fees_students_select_own
on public.fees
for select to authenticated
using (
  exists (
    select 1
      from public.students
     where students.id = fees.student_id
       and students.auth_user_id = auth.uid()
  )
);
create policy fees_admin_manage
on public.fees
for all to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

create policy fees_school_admin_manage
on public.fees
for all to authenticated
using (
  exists (
    select 1
      from public.profiles
     where profiles.id = auth.uid()
       and profiles.role = 'school_admin'
       and profiles.registered_school_id = fees.registered_school_id
  )
)
with check (
  exists (
    select 1
      from public.profiles
     where profiles.id = auth.uid()
       and profiles.role = 'school_admin'
       and profiles.registered_school_id = fees.registered_school_id
  )
);
