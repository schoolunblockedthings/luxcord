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
