create or replace function public.require_recent_authentication(maximum_age interval default interval '10 minutes')
returns void language plpgsql stable security invoker set search_path=public,auth
as $$
declare issued_at bigint;claims text;
begin
  claims:=current_setting('request.jwt.claims',true);
  if claims is not null and claims<>'' then issued_at:=nullif(claims::jsonb->>'iat','')::bigint; end if;
  issued_at:=coalesce(issued_at,nullif(current_setting('request.jwt.claim.iat',true),'')::bigint);
  if auth.uid() is null or issued_at is null or to_timestamp(issued_at)<now()-maximum_age or to_timestamp(issued_at)>now()+interval '1 minute' then
    raise exception 'recent authentication required' using errcode='42501';
  end if;
end $$;

alter function public.export_guardian_household(uuid) rename to export_guardian_household_authorized;
create function public.export_guardian_household(target_household uuid)
returns jsonb language plpgsql security definer set search_path=public,auth
as $$ begin perform public.require_recent_authentication();return public.export_guardian_household_authorized(target_household);end $$;

alter function public.request_guardian_household_deletion(uuid,text) rename to request_guardian_household_deletion_authorized;
create function public.request_guardian_household_deletion(target_household uuid,request_reason text default null)
returns table(request_id uuid,request_status text,created_at timestamptz)
language plpgsql security definer set search_path=public,auth
as $$ begin perform public.require_recent_authentication();return query select * from public.request_guardian_household_deletion_authorized(target_household,request_reason);end $$;

revoke all on function public.require_recent_authentication(interval),public.export_guardian_household_authorized(uuid),public.request_guardian_household_deletion_authorized(uuid,text),public.export_guardian_household(uuid),public.request_guardian_household_deletion(uuid,text) from public;
revoke all on function public.export_guardian_household_authorized(uuid),public.request_guardian_household_deletion_authorized(uuid,text) from authenticated;
grant execute on function public.export_guardian_household(uuid),public.request_guardian_household_deletion(uuid,text) to authenticated;
