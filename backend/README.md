# Backend

This folder now contains the Supabase schema setup needed by the frontend.

## Complete SQL setup in one file

[campusghana_all_migrations.sql](campusghana_all_migrations.sql) combines the required base schema and executable migrations in order for a brand-new Supabase project. Run it once in the SQL Editor after creating the project. The legacy base schema comes first because migration 001 references its student and profile tables. Do not run it on an existing project or database where any of these migrations were already applied; use the individual migration instructions below for incremental updates. Migration 010 is absent, and empty placeholder files are omitted.

After applying the SQL, deploy the Edge Functions required by your enabled features. Student account creation requires deploying `register-student` with `--no-verify-jwt`; student login provisioning requires deploying `provision-student-logins`. See the instructions below.

## Apply the remaining migrations in one run

The core tables and migration `001_public_portal_tables.sql` are already applied to the current Supabase project. To apply the remaining migrations, open the Supabase SQL Editor, paste the contents of [supabase/migrations/002_to_021_remaining_migrations.sql](supabase/migrations/002_to_021_remaining_migrations.sql), and run it once. It combines the available migrations from `002` through `021` in order; migration `010` is not present in this repository.

If you already ran that combined script, apply [supabase/migrations/022_fix_study_group_and_parent_message_rls.sql](supabase/migrations/022_fix_study_group_and_parent_message_rls.sql) separately to fix recursive study-group policies and parent-teacher message permissions. Do not rerun the combined script just to apply this fix.

Apply [supabase/migrations/023_student_phone_otp_auth.sql](supabase/migrations/023_student_phone_otp_auth.sql) after migration 022. It adds Auth-to-student linking, authenticated profile/student policies, study-feature RLS mappings, cloud-backed study progress fields, per-account display preferences, and the score uniqueness required by score updates. It stops with an explicit error if duplicate student/subject/exam scores must be resolved first.

Apply [supabase/migrations/024_student_id_password_auth.sql](supabase/migrations/024_student_id_password_auth.sql) after 023 to remove the former OTP account-link endpoint. Student sign-in uses the Student ID and password through Supabase Auth; Phone Auth and SMS provider setup are not required.

After 024, apply [supabase/migrations/025_student_portal_records.sql](supabase/migrations/025_student_portal_records.sql) and then [supabase/migrations/026_student_document_storage.sql](supabase/migrations/026_student_document_storage.sql). Migration 025 adds student-owned records for study plans, payment notices, payment-plan requests, attendance corrections, support tickets, goals, document metadata, assignment status, and announcement-read state. It also replaces the public fees policy with student read-only access and admin or school-scoped school-admin management. Migration 026 creates a private document bucket with per-student folder access.

Apply [supabase/migrations/028_scores_by_term_and_academic_year.sql](supabase/migrations/028_scores_by_term_and_academic_year.sql) after migration 026. It assigns existing scores without a recorded period to an explicitly labeled unspecified term/year, then allows a separate score for each subject, assessment, term, and academic year. Academic Scores uses the current term and academic year from Settings when saving; the student Results page groups records by academic year and term.

The student payment form only saves a payment notice for staff verification; it does not charge a card, transfer funds, or generate a transaction receipt. Actual payment processing requires selecting and integrating a payment provider.

These changes persist the implemented, connected workflows; they do not turn static/demo pages or placeholder features into real services. Some older tables outside these migrations still have permissive policies from the original setup. Review and replace those policies with authenticated, role- and school-scoped RLS before storing production personal, academic, or financial data. Applying these migrations is required before the newly connected student workflows and private document uploads can be used.

Student accounts use the alias `student-<Student-ID>@students.campusghana.invalid`; newly self-registered students receive a region-based ID such as `CG-AS011126001`, while existing Student IDs remain unchanged. Students sign in with their Student ID and password. The `provision-student-logins` Supabase Edge Function creates missing Auth accounts using the exact `students.parent_contact` value as the initial password, confirms the alias email, links `students.auth_user_id`, and creates the `student` profile. If the student has not marked a password as changed, running setup again resets it to the current parent/guardian contact. The My Profile password form marks the password as changed so subsequent setup attempts preserve it.

Deploy the function from the repository's `backend` directory after linking the Supabase project:

```sh
supabase functions deploy provision-student-logins --project-ref YOUR_PROJECT_REF
```

The function uses the Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets. Never expose the service-role key in frontend configuration.

New student enrollment attempts to create the login immediately. If that fails, administrators can select existing students in the Students directory and choose **Set Up Logins** to retry or provision existing students in batches. School administrators can provision only students assigned to their school. A student account is ready only after provisioning succeeds; student records without a supported Student ID or a guardian contact accepted as a Supabase password need correction first.

The parent/guardian contact is only the initial password. Students should change it immediately from **My Profile → Change Password**. Provisioning an existing login intentionally does not reset a password that the student has already changed. Passwords are stored only in Supabase Auth, never in the student record or frontend code.

For accounts created by the earlier manual process, the same provisioning function can link an existing alias account without changing its current password. To verify a student account, run this query with the ID substituted:

```sql
select s.index_number,
       s.auth_user_id,
       p.role
  from public.students s
  left join public.profiles p on p.id = s.auth_user_id
 where s.index_number = '123456789012'
    or s."index" = '123456789012';
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

For the multi-level Learning Library, apply [supabase/migrations/029_learning_hub_audiences.sql](supabase/migrations/029_learning_hub_audiences.sql) after the existing study-content migrations. It adds audience and material-type fields for JHS/BECE, SHS/WASSCE, and university resources. Existing materials are kept visible to all levels by default; review and retag them in the Learning Library editor as appropriate.

For student self-registration, apply [supabase/migrations/030_student_self_signup.sql](supabase/migrations/030_student_self_signup.sql) after migration 029. Then apply [supabase/migrations/031_student_registration_ids_and_verification.sql](supabase/migrations/031_student_registration_ids_and_verification.sql). It initializes atomic registration counters from existing student records without changing their IDs, assigns new IDs in the `CG-<region><regional number><MMYY><global number>` format (for example, `CG-AS011126001`), and adds durable in-portal profile-confirmation notifications. The regional and global number fields expand beyond their minimum widths instead of resetting. Deploy `register-student` with JWT verification disabled because it is called before the student has signed in:

```sh
supabase functions deploy register-student --no-verify-jwt --project-ref YOUR_PROJECT_REF
```

The signup form creates a confirmed student Auth account, a student profile and record, and a public profile-photo object. It generates the region-based Student ID, which must be saved and used with the chosen password to sign in. Email and phone are stored as student contact details; email is not currently verified and is not the sign-in ID. When an administrator confirms a profile, the student receives a persistent portal notification and a verified tick appears beside their name. Never expose the Supabase service-role key in the frontend.

The signup region selector uses the 16-region/261-district dataset from [Eric Bidopa's ghana-geo-data](https://github.com/EricBidopa/ghana-geo-data), adapted under CC BY-SA 4.0 with attribution in the data module.

For the Courses page, apply [supabase/migrations/032_courses_and_enrollment.sql](supabase/migrations/032_courses_and_enrollment.sql) after migration 031. It creates the course catalog, student enrollments, per-lesson progress, and authenticated RLS policies. Admins can create, edit, publish, and remove courses; students can enroll in published courses and track their own lesson completion.

For cross-role study teams, apply [supabase/migrations/037_deleted_student_retention.sql](supabase/migrations/037_deleted_student_retention.sql) and then [supabase/migrations/038_collaborative_study_teams.sql](supabase/migrations/038_collaborative_study_teams.sql). Students can create teams for their own education level and class and invite matching students; admins and tutors can create teams and invite students, tutors, and admins. Invitees accept or decline in the Study Teams page. Accepted members can discuss and share links or private files up to 20 MB.
