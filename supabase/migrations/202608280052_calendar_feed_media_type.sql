-- 052: serve the calendar feed as text/calendar through PostgREST 12's media-type handlers (#47).
--
-- WHY
--   050's calendar_feed(token) returns plain `text`, and nginx asked PostgREST for text/plain. The
--   first check against production (PostgREST 12.2.3) answered 406 PGRST107 "None of these media
--   types are available: text/plain": since v12, PostgREST only serves a raw body for a media type
--   that a function declares through a domain named after it. So the feed never reached a calendar.
--
-- WHAT
--   A domain "text/calendar" over text. The 050 function keeps its body and is renamed
--   calendar_feed_ics (no longer reachable by any client role); calendar_feed(token) becomes a thin
--   definer wrapper returning "text/calendar", so a request with Accept: text/calendar gets the ICS
--   body with Content-Type text/calendar. Refusals raise exactly as before (the inner function's).
--   Verified against the PostgREST 12.2.3 binary before shipping.

create domain public."text/calendar" as text;

alter function public.calendar_feed(text) rename to calendar_feed_ics;
revoke all on function public.calendar_feed_ics(text) from public, anon, authenticated;

create or replace function public.calendar_feed(token text)
returns public."text/calendar"
language sql stable security definer set search_path = public
as $function$
  select public.calendar_feed_ics(token)::public."text/calendar"
$function$;

revoke all on function public.calendar_feed(text) from public, authenticated;
grant execute on function public.calendar_feed(text) to anon;
