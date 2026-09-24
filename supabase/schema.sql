-- Ripasso: schema Supabase (incolla in SQL Editor ed esegui una volta)
create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  tbl text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_ts timestamptz not null default clock_timestamp(),
  primary key (user_id, tbl, id)
);
create index if not exists records_user_ts on public.records (user_id, server_ts);

-- last-write-wins: non sovrascrivere con una versione più vecchia
create or replace function public.records_lww() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  new.server_ts := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_lww on public.records;
create trigger records_lww before insert or update on public.records
  for each row execute function public.records_lww();

alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- realtime (aggiornamenti istantanei tra dispositivi)
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when others then null; end $$;

-- storage per PDF e immagini
insert into storage.buckets (id, name, public, file_size_limit)
values ('blobs', 'blobs', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "own blobs select" on storage.objects;
drop policy if exists "own blobs insert" on storage.objects;
drop policy if exists "own blobs update" on storage.objects;
drop policy if exists "own blobs delete" on storage.objects;
create policy "own blobs select" on storage.objects for select using (bucket_id = 'blobs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own blobs insert" on storage.objects for insert with check (bucket_id = 'blobs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own blobs update" on storage.objects for update using (bucket_id = 'blobs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own blobs delete" on storage.objects for delete using (bucket_id = 'blobs' and (storage.foldername(name))[1] = auth.uid()::text);
