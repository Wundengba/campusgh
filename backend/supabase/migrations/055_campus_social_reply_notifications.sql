alter table public.campus_social_notifications
  add column if not exists comment_id uuid
    references public.campus_social_comments (id) on delete set null,
  add column if not exists parent_comment_id uuid
    references public.campus_social_comments (id) on delete set null,
  add column if not exists comment_preview text;

create or replace function public.notify_campus_social_reply_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_author_id uuid;
  post_author_id uuid;
  actor_name text;
  post_preview text;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  select parent.author_id,
         post.author_id,
         coalesce(
           nullif(left(btrim(post.body), 180), ''),
           case when post.media_type = 'video' then 'A video post' else 'A photo post' end
         )
    into parent_author_id, post_author_id, post_preview
    from public.campus_social_comments as parent
    join public.campus_social_posts as post on post.id = new.post_id
   where parent.id = new.parent_comment_id
     and parent.post_id = new.post_id;

  if not found
     or parent_author_id is null
     or parent_author_id = new.author_id
     -- Migration 042 already notifies the post owner for comments.
     or parent_author_id = post_author_id then
    return new;
  end if;

  select nullif(btrim(profile.display_name), '')
    into actor_name
    from public.campus_social_profiles as profile
   where profile.user_id = new.author_id;

  insert into public.campus_social_notifications (
    recipient_id,
    actor_id,
    actor_name,
    post_id,
    event_type,
    reaction_type,
    post_preview,
    is_read,
    created_at,
    comment_id,
    parent_comment_id,
    comment_preview
  ) values (
    parent_author_id,
    new.author_id,
    coalesce(actor_name, 'Campus student'),
    new.post_id,
    'comment',
    null,
    post_preview,
    false,
    now(),
    new.id,
    new.parent_comment_id,
    coalesce(nullif(left(btrim(new.body), 280), ''), 'New reply')
  );

  return new;
end;
$$;

drop trigger if exists campus_social_reply_author_notification
  on public.campus_social_comments;
create trigger campus_social_reply_author_notification
  after insert on public.campus_social_comments
  for each row
  when (new.parent_comment_id is not null)
  execute function public.notify_campus_social_reply_author();

create or replace function public.notify_campus_social_comment_reaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  comment_author_id uuid;
  comment_post_id uuid;
  comment_parent_id uuid;
  comment_text text;
  post_text text;
  post_media_type text;
  actor_name text;
begin
  select comment.author_id,
         comment.post_id,
         comment.parent_comment_id,
         comment.body,
         post.body,
         post.media_type
    into comment_author_id,
         comment_post_id,
         comment_parent_id,
         comment_text,
         post_text,
         post_media_type
    from public.campus_social_comments as comment
    join public.campus_social_posts as post on post.id = comment.post_id
   where comment.id = new.comment_id;

  if not found or comment_author_id is null or comment_author_id = new.user_id then
    return new;
  end if;

  select nullif(btrim(profile.display_name), '')
    into actor_name
    from public.campus_social_profiles as profile
   where profile.user_id = new.user_id;

  insert into public.campus_social_notifications (
    recipient_id,
    actor_id,
    actor_name,
    post_id,
    event_type,
    reaction_type,
    post_preview,
    is_read,
    created_at,
    comment_id,
    parent_comment_id,
    comment_preview
  ) values (
    comment_author_id,
    new.user_id,
    coalesce(actor_name, 'Campus student'),
    comment_post_id,
    'reaction',
    new.reaction_type,
    coalesce(
      nullif(left(btrim(post_text), 180), ''),
      case when post_media_type = 'video' then 'A video post' else 'A photo post' end
    ),
    false,
    now(),
    new.comment_id,
    comment_parent_id,
    coalesce(nullif(left(btrim(comment_text), 280), ''), 'Comment')
  );

  return new;
end;
$$;

drop trigger if exists campus_social_comment_reaction_notification_insert
  on public.campus_social_comment_reactions;
create trigger campus_social_comment_reaction_notification_insert
  after insert on public.campus_social_comment_reactions
  for each row
  execute function public.notify_campus_social_comment_reaction();

drop trigger if exists campus_social_comment_reaction_notification_update
  on public.campus_social_comment_reactions;
create trigger campus_social_comment_reaction_notification_update
  after update of reaction_type on public.campus_social_comment_reactions
  for each row
  when (old.reaction_type is distinct from new.reaction_type)
  execute function public.notify_campus_social_comment_reaction();
