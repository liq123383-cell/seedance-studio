create extension if not exists pgcrypto;

create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_task_id text not null unique,
  prompt text not null,
  status text not null default 'queued',
  ratio text not null default '16:9',
  duration integer not null default 5,
  resolution text not null default '720p',
  provider_video_url text,
  stored_video_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_jobs_user_created_idx
  on public.video_jobs (user_id, created_at desc);

alter table public.video_jobs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'video_jobs'
      and policyname = 'Users can read their own video jobs'
  ) then
    create policy "Users can read their own video jobs"
      on public.video_jobs
      for select
      using (auth.uid() = user_id);
  end if;
end
$$;

-- The service role is used by server routes to create and update jobs.
-- Do not add permissive insert/update policies for the browser.

insert into storage.buckets (id, name, public)
values
  ('video-inputs', 'video-inputs', true),
  ('video-results', 'video-results', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can upload their own video inputs'
  ) then
    create policy "Users can upload their own video inputs"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'video-inputs'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can update their own video inputs'
  ) then
    create policy "Users can update their own video inputs"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'video-inputs'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'video-inputs'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end
$$;
