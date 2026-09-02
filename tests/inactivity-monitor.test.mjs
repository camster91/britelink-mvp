import assert from"node:assert/strict";
import test from"node:test";
import{startInactivityMonitor}from"../src/inactivity-monitor.js";

test("inactivity monitor resets on interaction, fires once, and cleans up",()=>{
 const listeners=new Map(),timers=new Map();let next=0,expired=0;const target={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),document:{visibilityState:"visible",addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}};
 const stop=startInactivityMonitor({target,timeoutMs:1000,onTimeout:()=>expired+=1,setTimer:fn=>{const id=++next;timers.set(id,fn);return id},clearTimer:id=>timers.delete(id)});const firstId=[...timers.keys()][0];listeners.get("keydown")();assert.equal(timers.size,1);assert.equal(timers.has(firstId),false);const[currentId,currentTimer]=[...timers.entries()][0];timers.delete(currentId);currentTimer();assert.equal(expired,1);listeners.get("pointerdown")();assert.equal(timers.size,0);stop();assert.equal(listeners.size,0);
});
