create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  title text not null,
  message text not null,
  student_id uuid references public.students (id) on delete cascade,
  ticket_record_key text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists admin_notifications_unread_created_idx
  on public.admin_notifications (created_at desc)
  where not is_read;

alter table public.admin_notifications enable row level security;
revoke all on public.admin_notifications from public, anon;
grant select, update (is_read) on public.admin_notifications to authenticated;
grant all on public.admin_notifications to service_role;

drop policy if exists admin_notifications_admin_read
  on public.admin_notifications;
create policy admin_notifications_admin_read
  on public.admin_notifications
  for select to authenticated
  using (public.is_current_user_admin());

drop policy if exists admin_notifications_admin_update
  on public.admin_notifications;
create policy admin_notifications_admin_update
  on public.admin_notifications
  for update to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

create or replace function public.notify_admin_of_student_support_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.record_type = 'support_ticket' then
    insert into public.admin_notifications (
      notification_type,
      title,
      message,
      student_id,
      ticket_record_key
    )
    values (
      'support_ticket_submitted',
      'New student support ticket',
      coalesce(nullif(btrim(new.payload->>'subject'), ''), 'A student submitted a support ticket.'),
      new.student_id,
      new.record_key
    );
  end if;
  return new;
end;
$$;

drop trigger if exists student_support_ticket_admin_notification
  on public.student_portal_records;
create trigger student_support_ticket_admin_notification
  after insert on public.student_portal_records
  for each row
  when (new.record_type = 'support_ticket')
  execute function public.notify_admin_of_student_support_ticket();

create or replace function public.respond_to_student_support_ticket(
  p_student_id uuid,
  p_record_key text,
  p_response text default null,
  p_status text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ticket_payload jsonb;
  response_text text := nullif(btrim(coalesce(p_response, '')), '');
  next_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if not public.is_current_user_admin() then
    raise exception 'Only administrators can respond to student support tickets.';
  end if;
  if response_text is null and next_status is null then
    raise exception 'Enter a response or select a ticket status.';
  end if;
  if response_text is not null and length(response_text) > 5000 then
    raise exception 'Response must be 5000 characters or fewer.';
  end if;
  if next_status is not null and next_status not in ('open', 'in_progress', 'resolved') then
    raise exception 'Choose a valid support ticket status.';
  end if;

  select payload
    into ticket_payload
    from public.student_portal_records
   where student_id = p_student_id
     and record_type = 'support_ticket'
     and record_key = p_record_key
   for update;
  if not found then
    raise exception 'Support ticket was not found.';
  end if;

  next_status := coalesce(next_status, ticket_payload->>'status', 'open');
  update public.student_portal_records
     set payload = ticket_payload
       || jsonb_build_object('status', next_status)
       || case
            when response_text is null then '{}'::jsonb
            else jsonb_build_object(
              'admin_response', response_text,
              'responded_at', now()
            )
          end
   where student_id = p_student_id
     and record_type = 'support_ticket'
     and record_key = p_record_key;

  insert into public.student_notifications (
    student_id,
    notification_type,
    title,
    message
  )
  values (
    p_student_id,
    case when response_text is null then 'support_ticket_status' else 'support_ticket_response' end,
    case when response_text is null then 'Support ticket updated' else 'Response to your support ticket' end,
    case
      when response_text is not null then response_text
      else 'Your support ticket "' ||
        coalesce(nullif(ticket_payload->>'subject', ''), 'Support request') ||
        '" is now ' || replace(next_status, '_', ' ') || '.'
    end
  );
end;
$$;

revoke all on function public.respond_to_student_support_ticket(uuid, text, text, text)
  from public, anon;
grant execute on function public.respond_to_student_support_ticket(uuid, text, text, text)
  to authenticated;

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
       and tablename = 'admin_notifications'
  ) then
    alter publication supabase_realtime add table public.admin_notifications;
  end if;
end;
$$;
