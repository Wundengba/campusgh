# Backend

This folder now contains the Supabase schema setup needed by the frontend.

## Apply the remaining migrations in one run

The core tables and migration `001_public_portal_tables.sql` are already applied to the current Supabase project. To apply the remaining migrations, open the Supabase SQL Editor, paste the contents of [supabase/migrations/002_to_021_remaining_migrations.sql](supabase/migrations/002_to_021_remaining_migrations.sql), and run it once. It combines the available migrations from `002` through `021` in order; migration `010` is not present in this repository.

If you already ran that combined script, apply [supabase/migrations/022_fix_study_group_and_parent_message_rls.sql](supabase/migrations/022_fix_study_group_and_parent_message_rls.sql) separately to fix recursive study-group policies and parent-teacher message permissions. Do not rerun the combined script just to apply this fix.

Apply [supabase/migrations/023_student_phone_otp_auth.sql](supabase/migrations/023_student_phone_otp_auth.sql) after migration 022. It adds Auth-to-student linking, authenticated profile/student policies, study-feature RLS mappings, cloud-backed study progress fields, per-account display preferences, and the score uniqueness required by score updates. It stops with an explicit error if duplicate student/subject/exam scores must be resolved first.

Apply [supabase/migrations/024_student_id_password_auth.sql](supabase/migrations/024_student_id_password_auth.sql) after 023 to remove the former OTP account-link endpoint. Student sign-in uses the 12-digit ID and password through Supabase Auth; Phone Auth and SMS provider setup are not required.

After 024, apply [supabase/migrations/025_student_portal_records.sql](supabase/migrations/025_student_portal_records.sql) and then [supabase/migrations/026_student_document_storage.sql](supabase/migrations/026_student_document_storage.sql). Migration 025 adds student-owned records for study plans, payment notices, payment-plan requests, attendance corrections, support tickets, goals, document metadata, assignment status, and announcement-read state. It also replaces the public fees policy with student read-only access and admin or school-scoped school-admin management. Migration 026 creates a private document bucket with per-student folder access.

The student payment form only saves a payment notice for staff verification; it does not charge a card, transfer funds, or generate a transaction receipt. Actual payment processing requires selecting and integrating a payment provider.

These changes persist the implemented, connected workflows; they do not turn static/demo pages or placeholder features into real services. Some older tables outside these migrations still have permissive policies from the original setup. Review and replace those policies with authenticated, role- and school-scoped RLS before storing production personal, academic, or financial data. Applying these migrations is required before the newly connected student workflows and private document uploads can be used.

Student accounts must be provisioned by an administrator; the app does not create student passwords or store them in the database. Set the student's initial Supabase Auth password to the parent/guardian contact recorded in `students.parent_contact` (use the exact value as stored). For each student:

1. In Supabase Authentication → Users, create or update the Auth user with email `student-<12-digit-ID>@students.campusghana.invalid`, set its password to the student's recorded parent/guardian contact, and mark the email as confirmed. For an existing OTP-linked account, update the existing user's email and password so its Auth UID and student link stay the same.
2. Run this in the SQL Editor, replacing the sample ID in both places. Confirm that the student row is linked and the profile row has role `student`.

```sql
update public.students as s
   set auth_user_id = u.id
  from auth.users as u
 where (s.index_number = '123456789012' or s."index" = '123456789012')
   and lower(u.email) = lower('student-123456789012@students.campusghana.invalid');

insert into public.profiles (id, email, full_name, role)
select u.id, u.email, s.full_name, 'student'
  from auth.users as u
  join public.students as s on s.auth_user_id = u.id
 where (s.index_number = '123456789012' or s."index" = '123456789012')
on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name
  where public.profiles.role = 'student';
```

The guardian contact is a weak, guessable password and may be shared by siblings. Treat it only as a temporary credential and change it to a unique password in Supabase Auth as soon as possible. Never put student passwords in `students`, `users`, or frontend code; Supabase Auth stores the password hash.

Staff must be created in Supabase Authentication with email/password and separately provisioned with a trusted profile role. After creating the Auth user, use its Auth UID in SQL Editor, for example:

```sql
insert into public.profiles (id, email, full_name, role)
values ('AUTH_USER_UUID', 'staff@example.com', 'Staff Name', 'admin');
```

Use an existing supported role (`admin`, `teacher`, `staff`, or `student`) and never accept role assignment from a public signup form.

For a fresh Supabase project, first run [supabase/migrations/create_users_students_scores_with_rls.sql](supabase/migrations/create_users_students_scores_with_rls.sql) and [supabase/migrations/001_public_portal_tables.sql](supabase/migrations/001_public_portal_tables.sql), then run the combined remaining-migrations script.

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

Security note: the original migrations grant open access to many operational tables. Migration 023 restricts profiles and students, but attendance, fees, scores, results, school selections, and several other tables still need authenticated, role-aware RLS policies before real personal or financial data is used. The anon key is public and does not replace RLS.
