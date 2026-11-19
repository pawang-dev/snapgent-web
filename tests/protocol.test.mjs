import { test } from "node:test";
import assert from "node:assert/strict";
import "../extension/content/protocol.js";
import { TOOL_SCHEMAS } from "../extension/core/fs-tools.js";

const P = globalThis.SnapgentProtocol;

test("extractCommand accepts plain JSON, fenced JSON and a json label", () => {
  const want = { command: "read_file", params: { path: "a.js" } };
  const raw = '{"command":"read_file","params":{"path":"a.js"}}';
  assert.deepEqual(P.extractCommand(raw), want);
  assert.deepEqual(P.extractCommand("```json\n" + raw + "\n```"), want);
  assert.deepEqual(P.extractCommand("json\n" + raw), want);
  assert.deepEqual(P.extractCommand('{"command":"list_dir"}'), { command: "list_dir", params: {} });
  assert.deepEqual(P.extractCommand('{"command":"list_dir","params":null}'), { command: "list_dir", params: {} });
});

test("extractCommand rejects everything else", () => {
  for (const bad of ["", "hello", "{", "[]", '{"command":""}', '{"command":1}', '{"command":"x","params":[]}', "null"]) {
    assert.equal(P.extractCommand(bad), null, bad);
  }
});

test("findCommand returns the first valid block", () => {
  assert.equal(P.findCommand(["const a = 1;", "{}"]), null);
  assert.equal(P.findCommand(["x", '{"command":"a"}', '{"command":"b"}']).command, "a");
});

test("only read-only tools run without approval", () => {
  for (const name of ["list_dir", "read_file", "search_text"]) assert.equal(P.needsConfirm(name), false, name);
  assert.equal(P.needsConfirm("write_file"), true);
  assert.equal(P.needsConfirm("edit_file"), true);
  assert.equal(P.needsConfirm("anything_else"), true);
});

test("formatResult covers success, read_file and failure", () => {
  assert.equal(P.formatResult("read_file", { ok: true, result: { path: "a.js", content: "x\ny" } }), "[snapgent result] read_file a.js\nx\ny");
  assert.equal(P.formatResult("list_dir", { ok: true, result: { path: ".", entries: [] } }), '[snapgent result] list_dir\n{"path":".","entries":[]}');
  const found = { query: "foo", path: ".", files_scanned: 3, truncated: false, matches: [{ path: "a.js", line: 2, text: "foo()" }] };
  assert.equal(P.formatResult("search_text", { ok: true, result: found }), '[snapgent result] search_text "foo"\na.js:2: foo()\n1 match(es) in 3 file(s) scanned');
  assert.equal(P.formatResult("search_text", { ok: true, result: { ...found, matches: [], truncated: true } }), '[snapgent result] search_text "foo"\n0 match(es) in 3 file(s) scanned; truncated, narrow the query or path');
  assert.equal(P.formatResult("write_file", { ok: false, error: "nope" }), "[snapgent result] write_file FAILED: nope");
  assert.equal(P.formatResult("write_file", undefined), "[snapgent result] write_file FAILED: no response");
});

test("buildPrompt lists every tool with required and optional params", () => {
  const prompt = P.buildPrompt(TOOL_SCHEMAS);
  for (const { name } of TOOL_SCHEMAS) assert.match(prompt, new RegExp(`- ${name}\\(`));
  assert.match(prompt, /- list_dir\(path\?\)/);
  assert.match(prompt, /- search_text\(query, path\?, case_sensitive\?, max_results\?\)/);
  assert.match(prompt, /- edit_file\(path, old_text, new_text, replace_all\?\)/);
  assert.match(prompt, /\[snapgent result\]/);
});
