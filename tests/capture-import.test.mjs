import assert from "node:assert/strict";
import test from "node:test";
import { IMPORT_LIMIT, captureRowsFromCsv, parseCsv } from "../src/capture-import.js";

test("CSV parsing handles quotes, doubled quotes, CRLF, a BOM and blank lines", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv('a\n"multi\nline"'), [["a"], ["multi\nline"]]);
});

test("imported rows are validated one by one and bad rows are named, not guessed", () => {
  const csv = [
    "date,kind,subjects,note",
    "2026-10-01,Book or reading,Language,Finished Charlotte's Web",
    '2026-10-02,field trip,"Science; Math","Pond walk, counted frogs"',
    "2026-10-03,therapy,,Speech session",
    "10/04/2026,note,,Bad date",
    "2026-12-25,note,,Future",
    "2026-10-05,note,Diagnosis,Nope",
    "2026-10-06,outing,,",
  ].join("\n");
  const { ready, problems } = captureRowsFromCsv(csv, "2026-10-10");
  assert.deepEqual(ready.map((row) => [row.capturedOn, row.kind, row.subjects]), [["2026-10-01", "book", ["Language"]], ["2026-10-02", "outing", ["Science", "Math"]]]);
  assert.deepEqual(problems.map((item) => item.slice(0, 6)), ["Row 4:", "Row 5:", "Row 6:", "Row 7:", "Row 8:"]);
  assert.match(problems[0], /kind is not one of/);
  assert.match(problems[3], /"Diagnosis" is not a subject/);
});

test("a file without the right columns, or too many rows, says so plainly", () => {
  assert.match(captureRowsFromCsv("when,what\n2026-10-01,x", "2026-10-10").problems[0], /missing: date, kind, note/);
  assert.match(captureRowsFromCsv("", "2026-10-10").problems[0], /empty/);
  const many = ["date,kind,subjects,note", ...Array.from({ length: IMPORT_LIMIT + 5 }, (_, i) => `2026-10-01,note,,Row ${i}`)].join("\n");
  const result = captureRowsFromCsv(many, "2026-10-10");
  assert.equal(result.ready.length, IMPORT_LIMIT);
  assert.match(result.problems[0], /Only the first 50 rows/);
});
