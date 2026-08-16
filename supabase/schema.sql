-- Daily Practice — Supabase schema.
-- Run this once in Supabase → SQL Editor → New query → paste → Run.

create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entry_date  date not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (user_id, entry_date)
);

alter table public.entries enable row level security;

-- Each signed-in user can only see and write their own rows.
drop policy if exists "own rows select" on public.entries;
create policy "own rows select" on public.entries
  for select using (auth.uid() = user_id);

drop policy if exists "own rows insert" on public.entries;
create policy "own rows insert" on public.entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "own rows update" on public.entries;
create policy "own rows update" on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows delete" on public.entries;
create policy "own rows delete" on public.entries
  for delete using (auth.uid() = user_id);

-- Standing user context (personalises analytical-meditation routines).
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  context     text,
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Web Push subscriptions (one per device) + reminder times + timezone.
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  subscription  jsonb not null,
  reminders     jsonb not null default '{}'::jsonb,
  tz            text,
  enabled       boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subs all" on public.push_subscriptions;
create policy "own subs all" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
