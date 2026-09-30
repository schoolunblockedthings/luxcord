-- Luxcord live chat enhancements
-- Run in the Supabase SQL editor.

alter table public.dm_messages
    add column if not exists read_at timestamptz;

create index if not exists dm_messages_conversation_created_idx
    on public.dm_messages (conversation_id, created_at);

create or replace function public.mark_dm_messages_read(p_conversation_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.dm_messages m
    set read_at = coalesce(m.read_at, timezone('utc', now()))
    from public.dm_conversations c
    where m.conversation_id = c.id
      and c.id = p_conversation_id
      and auth.uid() in (c.user_a, c.user_b)
      and m.sender_id <> auth.uid()
      and m.read_at is null;
end;
$$;

revoke all on function public.mark_dm_messages_read(bigint) from public;
grant execute on function public.mark_dm_messages_read(bigint) to authenticated;

alter table public.dm_messages replica identity full;
alter table public.dm_messages
    enable row level security;

-- Realtime already works for existing DM INSERT/UPDATE subscriptions when
-- dm_messages is in the publication. Add it only if it is not already present.
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'dm_messages'
    ) then
        alter publication supabase_realtime add table public.dm_messages;
    end if;
exception when undefined_object then
    null;
end $$;


-- Additional messaging features
alter table public.dm_messages add column if not exists edited_at timestamptz;
alter table public.dm_messages add column if not exists deleted_at timestamptz;
alter table public.dm_messages add column if not exists reply_to_id bigint references public.dm_messages(id) on delete set null;
alter table public.dm_messages add column if not exists attachment_url text;
alter table public.dm_messages add column if not exists attachment_name text;

create index if not exists dm_messages_reply_idx on public.dm_messages(reply_to_id);

create or replace function public.edit_dm_message(p_message_id bigint, p_message text)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.dm_messages
 set message=left(trim(p_message), 4000), edited_at=timezone('utc', now())
 where id=p_message_id and sender_id=auth.uid() and deleted_at is null;
end $$;

create or replace function public.delete_dm_message(p_message_id bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.dm_messages
 set message='', deleted_at=timezone('utc', now()), edited_at=null
 where id=p_message_id and sender_id=auth.uid() and deleted_at is null;
end $$;

revoke all on function public.edit_dm_message(bigint,text) from public;
grant execute on function public.edit_dm_message(bigint,text) to authenticated;
revoke all on function public.delete_dm_message(bigint) from public;
grant execute on function public.delete_dm_message(bigint) to authenticated;

insert into storage.buckets (id,name,public)
values ('luxcord-attachments','luxcord-attachments',true)
on conflict (id) do nothing;

create policy if not exists "Luxcord attachments upload"
on storage.objects for insert to authenticated
with check (bucket_id='luxcord-attachments' and owner_id=auth.uid()::text);

create policy if not exists "Luxcord attachments read"
on storage.objects for select to public
using (bucket_id='luxcord-attachments');
