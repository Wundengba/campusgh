-- STUDY GROUPS FEATURE
-- Create tables for collaborative study groups

-- Study groups table
create table if not exists public.study_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  subject text,
  class_level text,
  max_members integer default 10 check (max_members > 0 and max_members <= 50),
  is_private boolean not null default false,
  group_code text unique, -- For joining private groups
  created_by uuid references public.students(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Study group members table
create table if not exists public.study_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  unique(group_id, student_id)
);

-- Study group discussions/messages
create table if not exists public.study_group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  message_type text not null default 'text' check (message_type in ('text', 'file', 'study_content', 'question')),
  content text not null,
  reply_to uuid references public.study_group_messages(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Study group study sessions
create table if not exists public.study_group_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  title text not null,
  description text,
  scheduled_at timestamptz,
  duration_minutes integer,
  content_id uuid references public.study_content(id) on delete set null,
  created_by uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Study session participants
create table if not exists public.study_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.study_group_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'attending', 'declined', 'attended')),
  joined_at timestamptz,
  left_at timestamptz,
  unique(session_id, student_id)
);

-- Study group achievements/badges
create table if not exists public.study_group_achievements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  achievement_type text not null check (achievement_type in ('study_streak', 'questions_answered', 'content_shared', 'session_hosted', 'group_leader')),
  title text not null,
  description text,
  earned_at timestamptz not null default now(),
  earned_date date generated always as ((earned_at at time zone 'UTC')::date) stored,
  unique(group_id, student_id, achievement_type, earned_date)
);

-- Row Level Security (RLS) Policies
alter table public.study_groups enable row level security;
alter table public.study_group_members enable row level security;
alter table public.study_group_messages enable row level security;
alter table public.study_group_sessions enable row level security;
alter table public.study_session_participants enable row level security;
alter table public.study_group_achievements enable row level security;

-- RLS Policies for study_groups
create policy "Students can view public groups and their own groups" on public.study_groups
  for select using (
    not is_private or
    created_by = auth.uid() or
    exists (
      select 1 from public.study_group_members
      where group_id = study_groups.id and student_id = auth.uid()
    )
  );

create policy "Students can create groups" on public.study_groups
  for insert with check (auth.uid() = created_by);

create policy "Group admins can update their groups" on public.study_groups
  for update using (
    created_by = auth.uid() or
    exists (
      select 1 from public.study_group_members
      where group_id = study_groups.id and student_id = auth.uid() and role = 'admin'
    )
  );

-- RLS Policies for study_group_members
create policy "Members can view their group memberships" on public.study_group_members
  for select using (student_id = auth.uid());

create policy "Group admins can manage members" on public.study_group_members
  for all using (
    exists (
      select 1 from public.study_groups
      where id = group_id and (
        created_by = auth.uid() or
        exists (
          select 1 from public.study_group_members sgm
          where sgm.group_id = study_group_members.group_id
          and sgm.student_id = auth.uid()
          and sgm.role = 'admin'
        )
      )
    )
  );

-- RLS Policies for study_group_messages
create policy "Group members can view messages" on public.study_group_messages
  for select using (
    exists (
      select 1 from public.study_group_members
      where group_id = study_group_messages.group_id and student_id = auth.uid()
    )
  );

create policy "Group members can send messages" on public.study_group_messages
  for insert with check (
    student_id = auth.uid() and
    exists (
      select 1 from public.study_group_members
      where group_id = study_group_messages.group_id and student_id = auth.uid()
    )
  );

-- RLS Policies for study_group_sessions
create policy "Group members can view sessions" on public.study_group_sessions
  for select using (
    exists (
      select 1 from public.study_group_members
      where group_id = study_group_sessions.group_id and student_id = auth.uid()
    )
  );

create policy "Group members can create sessions" on public.study_group_sessions
  for insert with check (
    created_by = auth.uid() and
    exists (
      select 1 from public.study_group_members
      where group_id = study_group_sessions.group_id and student_id = auth.uid()
    )
  );

-- RLS Policies for study_session_participants
create policy "Session participants can view participation" on public.study_session_participants
  for select using (student_id = auth.uid());

create policy "Students can update their participation status" on public.study_session_participants
  for all using (student_id = auth.uid());

-- RLS Policies for study_group_achievements
create policy "Students can view their achievements" on public.study_group_achievements
  for select using (student_id = auth.uid());

create policy "System can create achievements" on public.study_group_achievements
  for insert with check (true);

-- Indexes for performance
create index idx_study_groups_created_by on public.study_groups(created_by);
create index idx_study_groups_subject on public.study_groups(subject);
create index idx_study_groups_class_level on public.study_groups(class_level);
create index idx_study_group_members_group_id on public.study_group_members(group_id);
create index idx_study_group_members_student_id on public.study_group_members(student_id);
create index idx_study_group_messages_group_id on public.study_group_messages(group_id);
create index idx_study_group_messages_created_at on public.study_group_messages(created_at desc);
create index idx_study_group_sessions_group_id on public.study_group_sessions(group_id);
create index idx_study_group_sessions_scheduled_at on public.study_group_sessions(scheduled_at);
create index idx_study_session_participants_session_id on public.study_session_participants(session_id);
create index idx_study_group_achievements_student_id on public.study_group_achievements(student_id);

-- Function to generate unique group codes
create or replace function generate_group_code()
returns text as $$
declare
  code text;
  exists_already boolean;
begin
  loop
    code := upper(substring(md5(random()::text) from 1 for 6));
    select exists(select 1 from public.study_groups where group_code = code) into exists_already;
    exit when not exists_already;
  end loop;
  return code;
end;
$$ language plpgsql;

-- Trigger to auto-generate group codes for private groups
create or replace function set_group_code()
returns trigger as $$
begin
  if NEW.is_private and (NEW.group_code is null or NEW.group_code = '') then
    NEW.group_code := generate_group_code();
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trigger_set_group_code
  before insert or update on public.study_groups
  for each row execute function set_group_code();

-- Function to auto-update updated_at timestamp
create or replace function update_study_group_updated_at()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

create trigger trigger_update_study_group_updated_at
  before update on public.study_groups
  for each row execute function update_study_group_updated_at();