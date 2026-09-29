# Luxcord upgraded

Features included:
- Supabase email/password authentication
- User profiles
- Friend requests and friend list
- Direct messages
- Message reactions
- Replies in room chat
- Notifications
- User settings and themes
- Existing guest room chat preserved

## Setup
1. Replace your current Luxcord files with the files in this ZIP.
2. Open Supabase SQL Editor.
3. Run `supabase/schema.sql`.
4. In Supabase Authentication settings, configure email confirmation as desired.
5. Open `index.html`.

The public Supabase anon key belongs in the frontend; security comes from Supabase RLS policies. Do not disable RLS.
