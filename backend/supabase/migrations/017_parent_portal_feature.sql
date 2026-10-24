-- PARENT PORTAL FEATURE
-- Create tables for parent access to student information

-- Parent accounts table
create table if not exists public.parents (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  phone text,
  first_name text not null,
  last_name text not null,
  relationship text not null check (relationship in ('mother', 'father', 'guardian', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Parent-student relationships
create table if not exists public.parent_students (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relationship text not null check (relationship in ('mother', 'father', 'guardian', 'other')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique(parent_id, student_id)
);

-- Parent notifications/messages
create table if not exists public.parent_notifications (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  notification_type text not null check (notification_type in ('academic_alert', 'attendance_warning', 'fee_reminder', 'event_reminder', 'general_message')),
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Parent communication with teachers
create table if not exists public.parent_teacher_messages (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents(id) on delete cascade,
  teacher_id bigint not null references public.teachers(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  subject text not null,
  message text not null,
  is_from_parent boolean not null default true,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Row Level Security (RLS) Policies
alter table public.parents enable row level security;
alter table public.parent_students enable row level security;
alter table public.parent_notifications enable row level security;
alter table public.parent_teacher_messages enable row level security;

-- RLS Policies for parents
create policy "Parents can view their own profile" on public.parents
  for select using (auth.uid() = id);

create policy "Parents can update their own profile" on public.parents
  for update using (auth.uid() = id);

create policy "System can create parent accounts" on public.parents
  for insert with check (true);

-- RLS Policies for parent_students
create policy "Parents can view their student relationships" on public.parent_students
  for select using (parent_id = auth.uid());

create policy "Parents can manage their student relationships" on public.parent_students
  for all using (parent_id = auth.uid());

create policy "System can create parent-student relationships" on public.parent_students
  for insert with check (true);

-- RLS Policies for parent_notifications
create policy "Parents can view their notifications" on public.parent_notifications
  for select using (parent_id = auth.uid());

create policy "Parents can mark notifications as read" on public.parent_notifications
  for update using (parent_id = auth.uid());

create policy "System can create notifications" on public.parent_notifications
  for insert with check (true);

-- RLS Policies for parent_teacher_messages
create policy "Parents can view messages involving their students" on public.parent_teacher_messages
  for select using (
    parent_id = auth.uid() or
    exists (
      select 1 from public.parent_students
      where parent_id = auth.uid() and student_id = parent_teacher_messages.student_id
    )
  );

create policy "Parents can send messages to teachers" on public.parent_teacher_messages
  for insert with check (
    parent_id = auth.uid() and is_from_parent = true
  );

create policy "Teachers can view and respond to parent messages" on public.parent_teacher_messages
  for select using (
    teacher_id in (
      select id from public.teachers where email = (select email from auth.users where id = auth.uid())
    )
  );

create policy "Teachers can send messages to parents" on public.parent_teacher_messages
  for insert with check (
    teacher_id in (
      select id from public.teachers where email = (select email from auth.users where id = auth.uid())
    ) and is_from_parent = false
  );

-- Indexes for performance
create index idx_parents_email on public.parents(email);
create index idx_parent_students_parent_id on public.parent_students(parent_id);
create index idx_parent_students_student_id on public.parent_students(student_id);
create index idx_parent_notifications_parent_id on public.parent_notifications(parent_id);
create index idx_parent_notifications_created_at on public.parent_notifications(created_at desc);
create index idx_parent_teacher_messages_parent_id on public.parent_teacher_messages(parent_id);
create index idx_parent_teacher_messages_teacher_id on public.parent_teacher_messages(teacher_id);
create index idx_parent_teacher_messages_created_at on public.parent_teacher_messages(created_at desc);

-- Function to auto-update updated_at timestamp for parents
create or replace function update_parent_updated_at()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

create trigger trigger_update_parent_updated_at
  before update on public.parents
  for each row execute function update_parent_updated_at();

-- Function to notify parents of important events
create or replace function notify_parent_event(
  p_student_id uuid,
  p_notification_type text,
  p_title text,
  p_message text
)
returns void as $$
declare
  parent_record record;
begin
  -- Send notification to all parents of the student
  for parent_record in
    select p.id, p.first_name, p.last_name
    from public.parents p
    join public.parent_students ps on p.id = ps.parent_id
    where ps.student_id = p_student_id
  loop
    insert into public.parent_notifications (parent_id, student_id, notification_type, title, message)
    values (parent_record.id, p_student_id, p_notification_type, p_title, p_message);
  end loop;
end;
$$ language plpgsql;