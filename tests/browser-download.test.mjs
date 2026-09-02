import assert from"node:assert/strict";
import test from"node:test";
import{navigateDownloadWindow,reserveDownloadWindow}from"../src/browser-download.js";

test("attachment download reserves a user-initiated window and reports popup blocking",()=>{
 assert.throws(()=>reserveDownloadWindow(()=>null),/blocked the download window/);
 const calls=[];const target={opener:{},location:{replace:url=>calls.push(url)}};assert.equal(reserveDownloadWindow(()=>target),target);assert.equal(target.opener,null);
 navigateDownloadWindow(target,"https://storage.example.test/signed");assert.deepEqual(calls,["https://storage.example.test/signed"]);
 assert.throws(()=>navigateDownloadWindow(target,""),/link was not created/);
});
