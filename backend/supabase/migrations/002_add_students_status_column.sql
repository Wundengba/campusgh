alter table public.students
add column if not exists status text default 'pending';

update public.students
set status = 'pending'
where status is null;

create index if not exists students_status_idx on public.students (status);
