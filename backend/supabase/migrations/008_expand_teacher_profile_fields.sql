alter table public.teachers add column if not exists employee_id text;
alter table public.teachers add column if not exists gender text;
alter table public.teachers add column if not exists date_of_birth date;
alter table public.teachers add column if not exists qualification text;
alter table public.teachers add column if not exists hire_date date;
alter table public.teachers add column if not exists address text;

create index if not exists teachers_employee_id_idx on public.teachers (employee_id);
create index if not exists teachers_hire_date_idx on public.teachers (hire_date);
