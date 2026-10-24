-- Remove super_admin role and consolidate all permissions to admin role
-- This migration removes the super_admin role option and reassigns any super_admin users to admin

-- Step 1: Update all super_admin users to admin role
update public.users set role = 'admin' where role = 'super_admin';
update public.profiles set role = 'admin' where role = 'super_admin';
update public.teachers set role = 'admin' where role = 'super_admin';
update public.school_admins set role = 'admin' where role = 'super_admin';

-- Step 2: Remove super_admin from role check constraints
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check 
  check (role in ('admin', 'teacher', 'staff', 'student'));

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check 
  check (role in ('admin', 'teacher', 'staff', 'student'));

alter table public.teachers drop constraint if exists teachers_role_check;
alter table public.teachers add constraint teachers_role_check 
  check (role in ('admin', 'teacher', 'staff', 'student'));

alter table public.school_admins drop constraint if exists school_admins_role_check;
alter table public.school_admins add constraint school_admins_role_check 
  check (role in ('admin', 'school_admin', 'teacher', 'staff', 'student'));

-- Step 3: Update the portal visibility restriction to check for admin role only
create or replace function public.enforce_portal_visibility_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  portal_settings_keys text[] := array[
    'adminFeesPortalEnabled',
    'studentFeesPortalEnabled',
    'studentDashboardEnabled',
    'studentProfileEnabled',
    'studentResultsEnabled',
    'studentAnalyticsEnabled',
    'studentReportCardEnabled',
    'studentStudyPlannerEnabled',
    'studentExamScheduleEnabled',
    'studentLiveTestsEnabled',
    'studentGoalsEnabled',
    'studentSelectSchoolsEnabled',
    'studentMySelectionEnabled',
    'studentSelectionPortalEnabled',
    'studentAttendanceEnabled',
    'studentAttendanceCorrectionsEnabled',
    'studentAnnouncementsEnabled',
    'studentAnnouncementsProEnabled',
    'studentSupportTicketsEnabled',
    'studentChatEnabled',
    'studentDocsEnabled',
    'studentUploadDocsEnabled',
    'studentResourcesEnabled',
    'studentAssignmentsEnabled',
    'studentCalendarSyncEnabled'
  ];
  key text;
  old_value jsonb;
  new_value jsonb;
begin
  -- Get current actor role
  actor_role := public.current_actor_role_key();
  
  -- Check if any portal visibility setting was changed
  for key in select unnest(portal_settings_keys) loop
    old_value := coalesce(old.config -> key, 'null'::jsonb);
    new_value := coalesce(new.config -> key, 'null'::jsonb);
    
    -- If the value changed and actor is not admin, raise exception
    if old_value is distinct from new_value and actor_role <> 'admin' then
      raise exception 'Only admins can change portal visibility settings.'
        using errcode = '42501';
    end if;
  end loop;
  
  return new;
end;
$$;

-- Drop old trigger and create new one
drop trigger if exists enforce_portal_visibility_super_admin on public.app_settings;
drop trigger if exists enforce_portal_visibility_admin on public.app_settings;

create trigger enforce_portal_visibility_admin
before update on public.app_settings
for each row execute function public.enforce_portal_visibility_admin();

-- Step 4: Remove role assignment restrictions since admin can assign any role
drop trigger if exists restrict_users_super_admin_assignment on public.users;
drop trigger if exists restrict_profiles_super_admin_assignment on public.profiles;
drop trigger if exists restrict_teachers_super_admin_assignment on public.teachers;
drop trigger if exists restrict_school_admins_super_admin_assignment on public.school_admins;

drop function if exists public.prevent_non_super_admin_assignment();
drop function if exists public.current_actor_is_super_admin();
