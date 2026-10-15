import assert from"node:assert/strict";
import test from"node:test";
import{LAST_ACTIVITY_KEY,startInactivityMonitor}from"../src/inactivity-monitor.js";

function harness({storage=new Map()}={}){
 const listeners=new Map(),timers=new Map();let next=0,clock=0,expired=0;
 const target={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),document:{visibilityState:"visible",addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}};
 const store={getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,value)};
 const stop=startInactivityMonitor({target,timeoutMs:60000,onTimeout:()=>expired+=1,setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:clock+delay});return id},clearTimer:id=>timers.delete(id),now:()=>clock,storage:store});
 // Moves the clock forward and runs any timer that is due, as a browser would.
 const advance=ms=>{clock+=ms;for(const[id,timer]of[...timers]){if(timer.at<=clock){timers.delete(id);timer.fn()}}};
 return{listeners,timers,storage,stop,advance,get expired(){return expired},set clock(value){clock=value},get clock(){return clock}};
}

test("inactivity monitor resets on interaction, fires once, and cleans up",()=>{
 const h=harness();h.advance(50000);h.listeners.get("keydown")();h.advance(50000);assert.equal(h.expired,0);h.advance(10000);assert.equal(h.expired,1);
 h.listeners.get("pointerdown")();assert.equal(h.timers.size,0);h.stop();assert.equal(h.listeners.size,0);
});

test("returning to a tab after a sleep signs out instead of restarting the clock",()=>{
 const h=harness();
 // The device slept: no timer ran, but two hours passed on the clock.
 h.clock=2*60*60*1000;h.listeners.get("visibilitychange")();assert.equal(h.expired,1);
});

test("returning to a tab before the timeout does not count as activity",()=>{
 const h=harness();h.clock=50000;h.listeners.get("visibilitychange")();assert.equal(h.expired,0);h.advance(10000);assert.equal(h.expired,1);
});

test("activity in another tab keeps this tab signed in",()=>{
 const h=harness();h.advance(50000);h.storage.set(LAST_ACTIVITY_KEY,String(h.clock));h.advance(10000);assert.equal(h.expired,0,"another tab was used 10s ago");h.advance(50000);assert.equal(h.expired,1);
});

test("with a warning, the family hears a minute before sign-out, and activity takes it back",()=>{
 const listeners=new Map(),timers=new Map();let next=0,clock=0;const calls=[];
 const target={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),document:{visibilityState:"visible",addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}};
 const advance=ms=>{clock+=ms;for(const[id,timer]of[...timers]){if(timer.at<=clock){timers.delete(id);timer.fn()}}};
 startInactivityMonitor({target,timeoutMs:120000,warnMs:60000,onWarn:()=>calls.push("warn"),onActive:()=>calls.push("active"),onTimeout:()=>calls.push("out"),setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:clock+delay});return id},clearTimer:id=>timers.delete(id),now:()=>clock,storage:null});
 advance(59000);assert.deepEqual(calls,[]);
 advance(1000);assert.deepEqual(calls,["warn"]);
 listeners.get("keydown")();assert.deepEqual(calls,["warn","active"],"pressing a key keeps them signed in");
 advance(60000);assert.deepEqual(calls,["warn","active","warn"]);
 advance(60000);assert.deepEqual(calls,["warn","active","warn","out"]);
});
