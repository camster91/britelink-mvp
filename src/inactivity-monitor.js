export const DEFAULT_INACTIVITY_MS=15*60*1000;

export function startInactivityMonitor({target=globalThis,timeoutMs=DEFAULT_INACTIVITY_MS,onTimeout,setTimer=setTimeout,clearTimer=clearTimeout}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<1000)throw new TypeError("Inactivity timeout must be at least one second");
 let timer=null,stopped=false,fired=false;
 const expire=()=>{if(stopped||fired)return;fired=true;onTimeout()};
 const reset=()=>{if(stopped||fired)return;clearTimer(timer);timer=setTimer(expire,timeoutMs)};
 for(const event of ["pointerdown","keydown","touchstart"])target.addEventListener?.(event,reset,{passive:true});
 const visibility=()=>{if(target.document?.visibilityState==="visible")reset()};target.document?.addEventListener?.("visibilitychange",visibility);
 reset();
 return()=>{stopped=true;clearTimer(timer);for(const event of ["pointerdown","keydown","touchstart"])target.removeEventListener?.(event,reset);target.document?.removeEventListener?.("visibilitychange",visibility)};
}
