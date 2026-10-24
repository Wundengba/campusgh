-- Fix RLS policy for live_tests to properly handle INSERT operations
-- The original policy only used USING clause which doesn't work for INSERT

-- Drop the old policy that doesn't support INSERT
drop policy if exists "Admins can manage live tests" on public.live_tests;

-- Create a comprehensive policy for all operations (INSERT, SELECT, UPDATE, DELETE)
create policy "Admins can manage live tests" on public.live_tests
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
    )
  );

-- Recreate student view policy if it was affected
drop policy if exists "Students can view active tests" on public.live_tests;

create policy "Students can view active tests" on public.live_tests
  for select using (is_active = true);
