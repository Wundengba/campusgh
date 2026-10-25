-- Student sign-in now uses admin-provisioned Supabase Auth email/password
-- accounts. Remove the earlier phone-OTP claim/link endpoint.
drop function if exists public.link_student_auth_user(text);
drop function if exists public.normalize_ghana_phone(text);
