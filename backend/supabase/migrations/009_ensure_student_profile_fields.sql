-- Migration: Ensure all required columns exist in public.students
alter table public.students add column if not exists gender text;
alter table public.students add column if not exists date_of_birth date;
alter table public.students add column if not exists parent_contact text;
alter table public.students add column if not exists personal_contact text;
alter table public.students add column if not exists home_address text;
alter table public.students add column if not exists home_town text;
alter table public.students add column if not exists place_of_residence text;
alter table public.students add column if not exists postal_town text;
alter table public.students add column if not exists po_box text;
-- You can run this migration in Supabase SQL editor or CLI
