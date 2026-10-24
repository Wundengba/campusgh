-- Add test_type column to live_tests table
-- Migration to add test type support to existing live tests

-- Step 1: Add test_type column (nullable first)
alter table public.live_tests
add column if not exists test_type text default 'mixed';

-- Step 2: Update any existing rows to have a default value
update public.live_tests 
set test_type = 'mixed' 
where test_type is null;

-- Step 3: Make the column not null
alter table public.live_tests
alter column test_type set not null;

-- Step 4: Add check constraint
alter table public.live_tests
add constraint test_type_valid_value 
check (test_type in ('multiple_choice', 'true_false', 'short_answer', 'fill_in', 'long_text', 'mixed'));