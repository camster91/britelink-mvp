import assert from"node:assert/strict";
import test from"node:test";
import{navigateDownloadWindow,reserveDownloadWindow}from"../src/browser-download.js";

test("attachment download reserves a user-initiated window and reports popup blocking",()=>{
 assert.throws(()=>reserveDownloadWindow(()=>null),/blocked the download window/);
 const calls=[];const target={opener:{},location:{replace:url=>calls.push(url)}};assert.equal(reserveDownloadWindow(()=>target),target);assert.equal(target.opener,null);
 navigateDownloadWindow(target,"https://storage.example.test/signed");assert.deepEqual(calls,["https://storage.example.test/signed"]);
 assert.throws(()=>navigateDownloadWindow(target,""),/link was not created/);
});

test("generated text files download through a revoked object URL", async () => {
  const { downloadTextFile } = await import("../src/browser-download.js");
  const events = [];
  const anchor = { style: {}, click: () => events.push(["click", anchor.href, anchor.download]), remove: () => events.push(["remove"]) };
  const urls = { createObjectURL: (blob) => { events.push(["create", blob.type]); return "blob:report"; }, revokeObjectURL: (url) => events.push(["revoke", url]) };
  const deferred = [];
  const doc = { createElement: () => anchor, body: { appendChild: (node) => events.push(["append", node === anchor]) } };
  downloadTextFile("report.csv", "a,b", "text/csv", doc, urls, (run) => deferred.push(run));
  assert.deepEqual(events, [["create", "text/csv"], ["append", true], ["click", "blob:report", "report.csv"]], "the URL stays valid through the click");
  deferred.forEach((run) => run());
  assert.deepEqual(events.slice(-2), [["remove"], ["revoke", "blob:report"]]);
});
