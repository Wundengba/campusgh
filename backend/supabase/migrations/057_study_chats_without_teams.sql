create or replace function public.start_collaborative_study_direct_conversation(
  p_other_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  conversation_id uuid;
begin
  if actor_id is null or p_other_user_id is null or actor_id = p_other_user_id then
    raise exception 'Choose another signed-in member to start a chat.'
      using errcode = '22023';
  end if;

  first_user := least(actor_id, p_other_user_id);
  second_user := greatest(actor_id, p_other_user_id);

  insert into public.collaborative_study_direct_conversations (
    participant_one, participant_two, created_by
  )
  values (first_user, second_user, actor_id)
  on conflict (participant_one, participant_two) do nothing;

  select conversation.id
    into conversation_id
    from public.collaborative_study_direct_conversations as conversation
   where conversation.participant_one = first_user
     and conversation.participant_two = second_user;

  return conversation_id;
end;
$$;

revoke all on function public.start_collaborative_study_direct_conversation(uuid)
  from public, anon;
grant execute on function public.start_collaborative_study_direct_conversation(uuid)
  to authenticated;
