export const DEFAULT_INACTIVITY_MS=15*60*1000;
// Shared by every BriteLink tab, so activity in one tab keeps the others signed in too. Only a
// timestamp is stored, never anything about the family.
export const LAST_ACTIVITY_KEY="britelink.lastActivityAt";

const safeStorage=target=>{try{return target.localStorage??null}catch{return null}};

// Signs out after timeoutMs without a tap, click or key press in any BriteLink tab. Elapsed time is
// measured on the clock, not by a running timer: an iPad or laptop that slept, or a tab left in the
// background, is checked against the real time since the last activity when it is used again.
export function startInactivityMonitor({target=globalThis,timeoutMs=DEFAULT_INACTIVITY_MS,onTimeout,setTimer=setTimeout,clearTimer=clearTimeout,now=()=>Date.now(),storage=safeStorage(target)}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<1000)throw new TypeError("Inactivity timeout must be at least one second");
 let timer=null,stopped=false,fired=false,lastActivity=now(),lastWrite=-Infinity;
 const shared=()=>{try{const value=Number(storage?.getItem(LAST_ACTIVITY_KEY));return Number.isFinite(value)?value:0}catch{return 0}};
 const latest=()=>Math.max(lastActivity,shared());
 const expire=()=>{if(stopped||fired)return;fired=true;clearTimer(timer);onTimeout()};
 const schedule=delay=>{clearTimer(timer);timer=setTimer(check,Math.max(1000,delay))};
 const check=()=>{if(stopped||fired)return;const idle=now()-latest();if(idle>=timeoutMs)expire();else schedule(timeoutMs-idle)};
 const activity=()=>{if(stopped||fired)return;lastActivity=now();
  // At most one write a second: pointer events can arrive many times a second.
  if(lastActivity-lastWrite>=1000){lastWrite=lastActivity;try{storage?.setItem(LAST_ACTIVITY_KEY,String(lastActivity))}catch{}}
  schedule(timeoutMs)};
 for(const event of ["pointerdown","keydown","touchstart"])target.addEventListener?.(event,activity,{passive:true});
 // Coming back to the tab is not activity: it only checks how long the household has been idle.
 const visibility=()=>{if(target.document?.visibilityState==="visible")check()};target.document?.addEventListener?.("visibilitychange",visibility);
 activity();
 return()=>{stopped=true;clearTimer(timer);for(const event of ["pointerdown","keydown","touchstart"])target.removeEventListener?.(event,activity);target.document?.removeEventListener?.("visibilitychange",visibility)};
}
