-- Restrict portal visibility settings to super admins only
-- This migration adds a trigger to enforce that only super admins can modify portal visibility settings

create or replace function public.enforce_portal_visibility_super_admin()
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
    
    -- If the value changed and actor is not super_admin, raise exception
    if old_value is distinct from new_value and actor_role <> 'super_admin' then
      raise exception 'Only super admins can change portal visibility settings.'
        using errcode = '42501';
    end if;
  end loop;
  
  return new;
end;
$$;

revoke all on function public.enforce_portal_visibility_super_admin() from public;
grant execute on function public.enforce_portal_visibility_super_admin() to anon, authenticated, service_role;

-- Drop existing trigger if it exists
drop trigger if exists enforce_portal_visibility_super_admin on public.app_settings;

-- Create trigger for update operations
create trigger enforce_portal_visibility_super_admin
before update on public.app_settings
for each row execute function public.enforce_portal_visibility_super_admin();
