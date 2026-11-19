grant delete on public.course_discussions to authenticated;

drop policy if exists "Authors and course staff can delete discussions"
  on public.course_discussions;
create policy "Authors and course staff can delete discussions"
  on public.course_discussions for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'super_admin', 'teacher', 'school_admin', 'staff')
    )
  );

notify pgrst, 'reload schema';
