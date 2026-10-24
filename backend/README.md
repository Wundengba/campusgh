# Backend

This folder now contains the Supabase schema setup needed by the frontend.

Run the SQL in [supabase/migrations/001_public_portal_tables.sql](supabase/migrations/001_public_portal_tables.sql) inside the Supabase SQL Editor for your project.

For the separate registered-school registry and school-admin login flow, also run [supabase/migrations/003_registered_schools_and_school_admins.sql](supabase/migrations/003_registered_schools_and_school_admins.sql).

For real school-scoped portal data isolation, also run [supabase/migrations/004_add_registered_school_scope.sql](supabase/migrations/004_add_registered_school_scope.sql).

For legacy teacher rows that already exist but still do not appear in the school-admin workspace, also run [supabase/migrations/007_backfill_teacher_registered_school_scope.sql](supabase/migrations/007_backfill_teacher_registered_school_scope.sql).

For the expanded teacher add/edit form, also run [supabase/migrations/008_expand_teacher_profile_fields.sql](supabase/migrations/008_expand_teacher_profile_fields.sql).

That migration creates the missing public tables currently referenced by the frontend:

- `attendance`
- `fees`
- `teachers`
- `events`
- `app_settings`
- `chat_messages`
- `scores`
- `results`

It also adds indexes, `updated_at` triggers, and permissive RLS policies so the current frontend anon key can read and write those tables.

Migration `003_registered_schools_and_school_admins.sql` adds:

- `registered_schools`
- `school_admins`
- `registered_school_id` and `managed_school_name` on `users`
- `registered_school_id` and `managed_school_name` on `profiles`

Without migration `003`, the Registered Schools page and school-admin portal routing will not work correctly.

Migration `004_add_registered_school_scope.sql` adds `registered_school_id` to the core operational tables used by the school portal, including:

- `students`
- `teachers`
- `attendance`
- `fees`
- `scores`
- `results`
- `events`
- `chat_messages`

Without migration `004`, the school portal can still open, but school-specific student, staff, attendance, finance, and results views cannot be safely scoped.

Migration `007_backfill_teacher_registered_school_scope.sql` backfills `teachers.registered_school_id` from matching `users` or `profiles` rows by teacher email when that mapping is unambiguous. Teachers without email, or emails that map to multiple schools, still need a manual Supabase update.

Migration `008_expand_teacher_profile_fields.sql` adds teacher profile columns used by the frontend add/edit form: `employee_id`, `gender`, `date_of_birth`, `qualification`, `hire_date`, and `address`.

Security note: the generated policies are intentionally open because the current app already uses public client-side reads and writes. For production, replace them with proper authenticated policies.
