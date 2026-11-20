create table if not exists public.student_verification_payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  payment_reference text not null unique,
  authorization_url text,
  amount_pesewas integer not null check (amount_pesewas between 1 and 10000000),
  currency text not null default 'GHS' check (currency = 'GHS'),
  status text not null default 'payment_pending'
    check (status in ('payment_pending', 'payment_failed', 'submitted')),
  paystack_transaction_id bigint,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'submitted' and paid_at is not null) or status <> 'submitted')
);

insert into public.student_verification_payment_intents (
  id,
  user_id,
  student_id,
  payment_reference,
  authorization_url,
  amount_pesewas,
  currency,
  status,
  paystack_transaction_id,
  paid_at,
  created_at,
  updated_at
)
select id,
       user_id,
       student_id,
       payment_reference,
       authorization_url,
       amount_pesewas,
       currency,
       status,
       paystack_transaction_id,
       paid_at,
       created_at,
       updated_at
  from public.student_verification_applications
 where status in ('payment_pending', 'payment_failed')
on conflict (payment_reference) do nothing;

delete from public.student_verification_applications
 where status in ('payment_pending', 'payment_failed');

alter table public.student_verification_applications
  drop constraint if exists student_verification_applications_status_check;
alter table public.student_verification_applications
  drop constraint if exists student_verification_applications_check;
alter table public.student_verification_applications
  alter column status drop default;
alter table public.student_verification_applications
  add constraint student_verification_applications_status_check
  check (status in ('pending_review', 'approved', 'declined'));
alter table public.student_verification_applications
  add constraint student_verification_applications_paid_check
  check (paid_at is not null);

drop index if exists public.student_verification_one_open_application_per_user_idx;
create unique index student_verification_one_open_application_per_user_idx
  on public.student_verification_applications (user_id)
  where status = 'pending_review';

create index if not exists student_verification_payment_intents_user_created_idx
  on public.student_verification_payment_intents (user_id, created_at desc);
create unique index if not exists student_verification_one_open_payment_intent_per_user_idx
  on public.student_verification_payment_intents (user_id)
  where status = 'payment_pending';

alter table public.student_verification_payment_intents enable row level security;
revoke all on public.student_verification_payment_intents from public, anon, authenticated;
grant all on public.student_verification_payment_intents to service_role;

create or replace function public.submit_student_verification_application(
  p_payment_reference text,
  p_paystack_transaction_id bigint,
  p_paid_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_intent public.student_verification_payment_intents%rowtype;
begin
  select intent.*
    into payment_intent
    from public.student_verification_payment_intents intent
   where intent.payment_reference = p_payment_reference
   for update;
  if not found then
    return false;
  end if;

  if payment_intent.status = 'submitted' then
    return exists (
      select 1
        from public.student_verification_applications application
       where application.payment_reference = p_payment_reference
    );
  end if;
  if payment_intent.status not in ('payment_pending', 'payment_failed') then
    return false;
  end if;
  if p_paid_at is null then
    raise exception 'A successful payment timestamp is required.';
  end if;

  insert into public.student_verification_applications (
    user_id,
    student_id,
    payment_reference,
    amount_pesewas,
    currency,
    status,
    paystack_transaction_id,
    paid_at
  )
  values (
    payment_intent.user_id,
    payment_intent.student_id,
    payment_intent.payment_reference,
    payment_intent.amount_pesewas,
    payment_intent.currency,
    'pending_review',
    p_paystack_transaction_id,
    p_paid_at
  );

  update public.student_verification_payment_intents
     set status = 'submitted',
         paystack_transaction_id = p_paystack_transaction_id,
         paid_at = p_paid_at,
         updated_at = now()
   where id = payment_intent.id;

  return true;
end;
$$;

revoke all on function public.submit_student_verification_application(text, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.submit_student_verification_application(text, bigint, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
