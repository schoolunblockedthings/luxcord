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

do $
begin
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Luxcord attachments upload') then
        create policy "Luxcord attachments upload"
        on storage.objects for insert to authenticated
        with check (bucket_id='luxcord-attachments' and owner_id=auth.uid()::text);
    end if;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Luxcord attachments read') then
        create policy "Luxcord attachments read"
        on storage.objects for select to public
        using (bucket_id='luxcord-attachments');
    end if;
end $;


alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists avatar_url text;



-- Private notes that each user can keep about other profiles.
create table if not exists public.profile_notes (
    user_id uuid not null references public.profiles(id) on delete cascade,
    profile_id uuid not null references public.profiles(id) on delete cascade,
    notes text not null default '',
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, profile_id),
    constraint profile_notes_not_self check (user_id <> profile_id)
);

alter table public.profile_notes enable row level security;

drop policy if exists "Profile notes own rows" on public.profile_notes;
create policy "Profile notes own rows"
on public.profile_notes
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index if not exists profile_notes_profile_idx
    on public.profile_notes (profile_id);


-- Group chats

create or replace function public.leave_group(p_group_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $
begin
    if not exists (
        select 1 from public.group_members
        where group_id = p_group_id and user_id = auth.uid()
    ) then
        return false;
    end if;

    delete from public.group_members
    where group_id = p_group_id and user_id = auth.uid();

    return true;
end;
$;

revoke all on function public.leave_group(bigint) from public;
grant execute on function public.leave_group(bigint) to authenticated;


create table if not exists public.group_conversations (
    id bigint generated by default as identity primary key,
    name text not null check (char_length(trim(name)) between 1 and 80),
    created_by uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.group_members (
    group_id bigint not null references public.group_conversations(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    added_by uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (group_id, user_id)
);

create table if not exists public.group_messages (
    id bigint generated by default as identity primary key,
    group_id bigint not null references public.group_conversations(id) on delete cascade,
    sender_id uuid not null references public.profiles(id) on delete cascade,
    message text not null check (char_length(trim(message)) > 0),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists group_members_user_idx on public.group_members(user_id);
create index if not exists group_messages_group_created_idx on public.group_messages(group_id, created_at);

alter table public.group_conversations enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

create schema if not exists private;

create or replace function private.user_group_ids()
returns setof bigint
language sql
security definer
set search_path = ''
stable
as $$
    select group_id from public.group_members
    where user_id = (select auth.uid())
$$;

create or replace function private.group_created_by_me(p_group_id bigint)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
    select exists (
        select 1 from public.group_conversations
        where id = p_group_id
          and created_by = (select auth.uid())
    )
$$;

revoke all on function private.user_group_ids() from public;
revoke all on function private.group_created_by_me(bigint) from public;
grant usage on schema private to authenticated;
grant execute on function private.user_group_ids() to authenticated;
grant execute on function private.group_created_by_me(bigint) to authenticated;

create table if not exists public.group_message_reads (
    group_id bigint not null references public.group_conversations(id) on delete cascade,
    message_id bigint not null references public.group_messages(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    read_at timestamptz not null default timezone('utc', now()),
    primary key (message_id, user_id)
);

create index if not exists group_message_reads_group_user_idx on public.group_message_reads(group_id, user_id);

alter table public.group_message_reads enable row level security;

drop policy if exists "Group members can read group reads" on public.group_message_reads;
create policy "Group members can read group reads"
on public.group_message_reads for select
to authenticated
using (group_id in (select private.user_group_ids()));

drop policy if exists "Members can mark group messages read" on public.group_message_reads;
create policy "Members can mark group messages read"
on public.group_message_reads for insert
to authenticated
with check (
    user_id = (select auth.uid())
    and group_id in (select private.user_group_ids())
);

drop policy if exists "Members can update group reads" on public.group_message_reads;
create policy "Members can update group reads"
on public.group_message_reads for update
to authenticated
using (user_id = (select auth.uid()) and group_id in (select private.user_group_ids()))
with check (user_id = (select auth.uid()) and group_id in (select private.user_group_ids()));



drop policy if exists "Group members can read groups" on public.group_conversations;
create policy "Group members can read groups"
on public.group_conversations for select
to authenticated
using (created_by = (select auth.uid()) or id in (select private.user_group_ids()));

drop policy if exists "Users can create groups" on public.group_conversations;
create policy "Users can create groups"
on public.group_conversations for insert
to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists "Group members can read membership" on public.group_members;
create policy "Group members can read membership"
on public.group_members for select
to authenticated
using (group_id in (select private.user_group_ids()));

drop policy if exists "Group creators can add members" on public.group_members;
drop policy if exists "Group members can add members" on public.group_members;
create policy "Group members can add members"
on public.group_members for insert
to authenticated
with check (group_id in (select private.user_group_ids()));

drop policy if exists "Group members can leave" on public.group_members;
create policy "Group members can leave"
on public.group_members for delete
to authenticated
using (user_id = (select auth.uid()) and group_id in (select private.user_group_ids()));

drop policy if exists "Group members can read messages" on public.group_messages;
create policy "Group members can read messages"
on public.group_messages for select
to authenticated
using (group_id in (select private.user_group_ids()));

drop policy if exists "Group members can send messages" on public.group_messages;
create policy "Group members can send messages"
on public.group_messages for insert
to authenticated
with check (
    sender_id = (select auth.uid())
    and group_id in (select private.user_group_ids())
);

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'group_messages'
    ) then
        alter publication supabase_realtime add table public.group_messages;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'group_members'
    ) then
        alter publication supabase_realtime add table public.group_members;
    end if;
exception when undefined_object then
    null;
end $$;
