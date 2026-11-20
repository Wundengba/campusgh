create table if not exists public.student_verification_payment_settings (
  id smallint primary key default 1 check (id = 1),
  fee_pesewas integer not null default 0
    check (fee_pesewas between 0 and 10000000),
  currency text not null default 'GHS'
    check (currency = 'GHS'),
  updated_at timestamptz not null default now()
);

insert into public.student_verification_payment_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.student_verification_payment_settings enable row level security;
revoke all on public.student_verification_payment_settings from public, anon, authenticated;
grant select on public.student_verification_payment_settings to authenticated;
grant all on public.student_verification_payment_settings to service_role;

drop policy if exists "Authenticated users can view verification fees"
  on public.student_verification_payment_settings;
create policy "Authenticated users can view verification fees"
  on public.student_verification_payment_settings for select to authenticated
  using (true);

create table if not exists public.student_verification_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  payment_reference text not null unique,
  authorization_url text,
  amount_pesewas integer not null check (amount_pesewas between 1 and 10000000),
  currency text not null default 'GHS' check (currency = 'GHS'),
  status text not null default 'payment_pending'
    check (status in ('payment_pending', 'payment_failed', 'pending_review', 'approved', 'declined')),
  paystack_transaction_id bigint,
  paid_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (char_length(review_note) <= 500),
  refund_status text not null default 'not_applicable'
    check (refund_status in ('not_applicable', 'manual_review_required', 'refunded', 'not_refunded')),
  refund_note text check (char_length(refund_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('pending_review', 'approved', 'declined') and paid_at is not null)
    or status in ('payment_pending', 'payment_failed')
  )
);

create index if not exists student_verification_applications_user_created_idx
  on public.student_verification_applications (user_id, created_at desc);
create index if not exists student_verification_applications_status_created_idx
  on public.student_verification_applications (status, created_at desc);
create unique index if not exists student_verification_one_open_application_per_user_idx
  on public.student_verification_applications (user_id)
  where status in ('payment_pending', 'pending_review');

alter table public.student_verification_applications enable row level security;
revoke all on public.student_verification_applications from public, anon, authenticated;
grant select on public.student_verification_applications to authenticated;
grant all on public.student_verification_applications to service_role;

drop policy if exists "Students can view their verification applications"
  on public.student_verification_applications;
create policy "Students can view their verification applications"
  on public.student_verification_applications for select to authenticated
  using (user_id = auth.uid());

create or replace function public.set_student_verification_fee(p_fee_pesewas integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_actor_role_key();
  saved_fee integer;
begin
  if auth.uid() is null or actor_role is null or actor_role not in ('admin', 'super_admin') then
    raise exception 'Only administrators can change the verification fee.'
      using errcode = '42501';
  end if;

  if p_fee_pesewas is null or p_fee_pesewas < 0 or p_fee_pesewas > 10000000 then
    raise exception 'The verification fee must be between GHS 0.00 and GHS 100,000.00.'
      using errcode = '22023';
  end if;

  update public.student_verification_payment_settings
     set fee_pesewas = p_fee_pesewas,
         updated_at = now()
   where id = 1
   returning fee_pesewas into saved_fee;

  if saved_fee is null then
    raise exception 'Verification payment settings are unavailable.';
  end if;

  return saved_fee;
end;
$$;

revoke all on function public.set_student_verification_fee(integer)
  from public, anon, authenticated;
grant execute on function public.set_student_verification_fee(integer)
  to authenticated;

create or replace function public.list_student_verification_applications()
returns table (
  application_id uuid,
  student_id uuid,
  student_name text,
  student_index text,
  registered_school_id bigint,
  school_name text,
  status text,
  payment_reference text,
  amount_pesewas integer,
  currency text,
  paid_at timestamptz,
  created_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  refund_status text,
  refund_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_actor_role_key();
  actor_school_id bigint;
begin
  if auth.uid() is null or actor_role is null or actor_role not in ('admin', 'super_admin', 'school_admin') then
    raise exception 'Only administrators can review verification applications.'
      using errcode = '42501';
  end if;

  select profile.registered_school_id
    into actor_school_id
    from public.profiles profile
   where profile.id = auth.uid();

  if actor_role = 'school_admin' and actor_school_id is null then
    raise exception 'Your administrator account is not assigned to a school.'
      using errcode = '42501';
  end if;

  return query
  select application.id,
         student.id,
         student.full_name,
         coalesce(to_jsonb(student)->>'index_number', to_jsonb(student)->>'index'),
         student.registered_school_id,
         school.name,
         application.status,
         application.payment_reference,
         application.amount_pesewas,
         application.currency,
         application.paid_at,
         application.created_at,
         application.reviewed_at,
         application.review_note,
         application.refund_status,
         application.refund_note
    from public.student_verification_applications application
    join public.students student on student.id = application.student_id
    left join public.registered_schools school
      on school.id = student.registered_school_id
   where actor_role <> 'school_admin'
      or student.registered_school_id = actor_school_id
   order by case when application.status = 'pending_review' then 0 else 1 end,
            application.created_at desc
   limit 200;
end;
$$;

revoke all on function public.list_student_verification_applications()
  from public, anon, authenticated;
grant execute on function public.list_student_verification_applications()
  to authenticated;

create or replace function public.review_student_verification_application(
  p_application_id uuid,
  p_decision text,
  p_review_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text := public.current_actor_role_key();
  actor_school_id bigint;
  application_row public.student_verification_applications%rowtype;
  student_school_id bigint;
  student_status text;
  normalized_note text := nullif(btrim(p_review_note), '');
begin
  if actor_id is null or actor_role is null or actor_role not in ('admin', 'super_admin', 'school_admin') then
    raise exception 'Only administrators can review verification applications.'
      using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'decline') then
    raise exception 'Choose approve or decline.'
      using errcode = '22023';
  end if;
  if char_length(coalesce(normalized_note, '')) > 500 then
    raise exception 'Review notes must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  select profile.registered_school_id
    into actor_school_id
    from public.profiles profile
   where profile.id = actor_id;

  select application.*
    into application_row
    from public.student_verification_applications application
   where application.id = p_application_id
   for update;
  if not found or application_row.status <> 'pending_review' then
    raise exception 'This paid application is not awaiting review.'
      using errcode = 'P0002';
  end if;

  select student.registered_school_id, lower(coalesce(student.status, 'pending'))
    into student_school_id, student_status
    from public.students student
   where student.id = application_row.student_id
   for update;
  if not found then
    raise exception 'The student record for this application no longer exists.'
      using errcode = 'P0002';
  end if;
  if actor_role = 'school_admin'
     and (actor_school_id is null or student_school_id is distinct from actor_school_id) then
    raise exception 'You can only review applications for your assigned school.'
      using errcode = '42501';
  end if;
  if p_decision = 'approve' and student_status = 'suspended' then
    raise exception 'A suspended student account cannot be verified.'
      using errcode = '22023';
  end if;

  update public.student_verification_applications
     set status = case when p_decision = 'approve' then 'approved' else 'declined' end,
         reviewed_at = now(),
         reviewed_by = actor_id,
         review_note = normalized_note,
         refund_status = case
           when p_decision = 'decline' then 'manual_review_required'
           else 'not_applicable'
         end,
         updated_at = now()
   where id = p_application_id;

  if p_decision = 'approve' then
    update public.students
       set status = 'confirmed'
     where id = application_row.student_id;
  end if;

  return case when p_decision = 'approve' then 'approved' else 'declined' end;
end;
$$;

revoke all on function public.review_student_verification_application(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_student_verification_application(uuid, text, text)
  to authenticated;

create or replace function public.update_student_verification_refund(
  p_application_id uuid,
  p_refund_status text,
  p_refund_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text := public.current_actor_role_key();
  actor_school_id bigint;
  application_school_id bigint;
  normalized_note text := nullif(btrim(p_refund_note), '');
begin
  if actor_id is null or actor_role is null or actor_role not in ('admin', 'super_admin', 'school_admin') then
    raise exception 'Only administrators can update refund handling.'
      using errcode = '42501';
  end if;
  if p_refund_status is null or p_refund_status not in ('refunded', 'not_refunded') then
    raise exception 'Choose refunded or not refunded.'
      using errcode = '22023';
  end if;
  if char_length(coalesce(normalized_note, '')) > 500 then
    raise exception 'Refund notes must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  select profile.registered_school_id
    into actor_school_id
    from public.profiles profile
   where profile.id = actor_id;

  select student.registered_school_id
    into application_school_id
    from public.student_verification_applications application
    join public.students student on student.id = application.student_id
   where application.id = p_application_id
     and application.status = 'declined'
   for update of application;
  if not found then
    raise exception 'Refund handling is available only for declined applications.'
      using errcode = 'P0002';
  end if;
  if actor_role = 'school_admin'
     and (actor_school_id is null or application_school_id is distinct from actor_school_id) then
    raise exception 'You can only manage refunds for your assigned school.'
      using errcode = '42501';
  end if;

  update public.student_verification_applications
     set refund_status = p_refund_status,
         refund_note = normalized_note,
         updated_at = now()
   where id = p_application_id;

  return p_refund_status;
end;
$$;

revoke all on function public.update_student_verification_refund(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_student_verification_refund(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';
