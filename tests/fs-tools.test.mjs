import { test } from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../extension/core/fs-tools.js";
import { splitPath } from "../extension/core/path.js";

// Minimal in-memory stand-in for FileSystemDirectoryHandle / FileSystemFileHandle.
function domError(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}
class FakeFile {
  constructor(name) { this.kind = "file"; this.name = name; this.bytes = new Uint8Array(); }
  async getFile() { const b = this.bytes; return { size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; }
  async createWritable() {
    return { write: async (data) => { this.bytes = new TextEncoder().encode(data); }, close: async () => {} };
  }
}
class FakeDir {
  constructor(name = "root") { this.kind = "directory"; this.name = name; this.children = new Map(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    const hit = this.children.get(name);
    if (hit) { if (hit.kind !== "directory") throw domError("TypeMismatchError"); return hit; }
    if (!create) throw domError("NotFoundError");
    const dir = new FakeDir(name); this.children.set(name, dir); return dir;
  }
  async getFileHandle(name, { create = false } = {}) {
    const hit = this.children.get(name);
    if (hit) { if (hit.kind !== "file") throw domError("TypeMismatchError"); return hit; }
    if (!create) throw domError("NotFoundError");
    const file = new FakeFile(name); this.children.set(name, file); return file;
  }
  async *entries() { yield* this.children.entries(); }
}

const setup = () => createTools(new FakeDir());

test("splitPath rejects absolute paths and traversal", () => {
  assert.deepEqual(splitPath("a\\b/./c"), ["a", "b", "c"]);
  assert.deepEqual(splitPath(""), []);
  assert.throws(() => splitPath("/etc/passwd"), /relative/);
  assert.throws(() => splitPath("C:/Users/x"), /relative/);
  assert.throws(() => splitPath("a/../../b"), /escapes/);
});

test("write_file creates parents; read_file returns the text", async () => {
  const t = setup();
  assert.deepEqual(await t.call("write_file", { path: "src/a/b.txt", content: "héllo" }), { path: "src/a/b.txt", bytes: 6 });
  assert.equal((await t.call("read_file", { path: "src/a/b.txt" })).content, "héllo");
});

test("list_dir sorts folders first", async () => {
  const t = setup();
  await t.call("write_file", { path: "z.txt", content: "1" });
  await t.call("write_file", { path: "dir/a.txt", content: "1" });
  assert.deepEqual((await t.call("list_dir", {})).entries, [
    { name: "dir", type: "dir" },
    { name: "z.txt", type: "file" },
  ]);
});

test("edit_file needs a unique match unless replace_all", async () => {
  const t = setup();
  await t.call("write_file", { path: "f.txt", content: "a b a $& a" });
  await assert.rejects(t.call("edit_file", { path: "f.txt", old_text: "a", new_text: "X" }), /3 places/);
  await assert.rejects(t.call("edit_file", { path: "f.txt", old_text: "zzz", new_text: "X" }), /not found/);
  assert.equal((await t.call("edit_file", { path: "f.txt", old_text: "$&", new_text: "$1" })).replaced, 1);
  await t.call("edit_file", { path: "f.txt", old_text: "a", new_text: "X", replace_all: true });
  assert.equal((await t.call("read_file", { path: "f.txt" })).content, "X b X $1 X");
});

test("errors: missing file, .git write, binary file, unknown tool", async () => {
  const t = setup();
  await assert.rejects(t.call("read_file", { path: "nope.txt" }), /Not found/);
  await assert.rejects(t.call("write_file", { path: ".git/config", content: "x" }), /\.git/);
  await assert.rejects(t.call("write_file", { path: "a.txt" }), /content must be a string/);
  await assert.rejects(t.call("read_file", { path: "../x" }), /escapes/);
  await assert.rejects(t.call("delete_file", {}), /Unknown tool/);
  const root = new FakeDir();
  const bin = await root.getFileHandle("b.bin", { create: true });
  bin.bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
  await assert.rejects(createTools(root).call("read_file", { path: "b.bin" }), /UTF-8/);
});

async function put(root, path, content) {
  const parts = path.split("/");
  const name = parts.pop();
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  const file = await dir.getFileHandle(name, { create: true });
  file.bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
}
const hits = (r) => r.matches.map((m) => `${m.path}:${m.line}`);

test("search_text finds lines, ignores case by default, and returns a stable order", async () => {
  const root = new FakeDir();
  const t = createTools(root);
  await put(root, "src/b.js", "const A = 1;\nfoo(Hello)\n");
  await put(root, "src/a.js", "hello world\r\nnothing\n  say hello again  \n");
  await put(root, "README.md", "HELLO");
  const r = await t.call("search_text", { query: "hello" });
  assert.deepEqual(hits(r), ["README.md:1", "src/a.js:1", "src/a.js:3", "src/b.js:2"]);
  assert.equal(r.matches[2].text, "say hello again");
  assert.equal(r.files_scanned, 3);
  assert.equal(r.truncated, false);
  assert.deepEqual(hits(await t.call("search_text", { query: "hello", case_sensitive: true })), ["src/a.js:1", "src/a.js:3"]);
});

test("search_text skips build folders, binary, oversized and non-UTF-8 files", async () => {
  const root = new FakeDir();
  const t = createTools(root);
  await put(root, "node_modules/x/a.js", "needle");
  await put(root, ".git/config", "needle");
  await put(root, "dist/o.js", "needle");
  await put(root, "src/ok.js", "needle");
  await put(root, "src/bin.dat", new Uint8Array([110, 0, 110]));
  await put(root, "src/big.txt", "needle" + "a".repeat(200_001));
  await put(root, "src/latin.txt", new Uint8Array([110, 0xff]));
  const r = await t.call("search_text", { query: "n" });
  assert.deepEqual(hits(r), ["src/ok.js:1"]);
  assert.equal(r.files_scanned, 4);
});

test("search_text can be limited to a folder and rejects bad input", async () => {
  const root = new FakeDir();
  const t = createTools(root);
  await put(root, "a/x.txt", "needle");
  await put(root, "b/y.txt", "needle");
  const r = await t.call("search_text", { query: "needle", path: "a" });
  assert.deepEqual(hits(r), ["a/x.txt:1"]);
  assert.equal(r.path, "a");
  await assert.rejects(t.call("search_text", { query: "" }), /non-empty/);
  await assert.rejects(t.call("search_text", {}), /non-empty/);
  await assert.rejects(t.call("search_text", { query: "x", path: "missing" }), /Not found/);
  await assert.rejects(t.call("search_text", { query: "x", path: "a/x.txt" }), /Not found/);
  await assert.rejects(t.call("search_text", { query: "x", path: "../a" }), /escapes/);
});

test("search_text caps results and files and reports truncation", async () => {
  const root = new FakeDir();
  const t = createTools(root);
  await put(root, "five.txt", "m\nm\nm\nm\nm");
  assert.equal((await t.call("search_text", { query: "m", max_results: 3 })).matches.length, 3);
  assert.equal((await t.call("search_text", { query: "m", max_results: 3 })).truncated, true);
  assert.equal((await t.call("search_text", { query: "m", max_results: 5 })).truncated, false);
  await put(root, "many.txt", "m\n".repeat(250));
  const big = await t.call("search_text", { query: "m", max_results: 99999 });
  assert.equal(big.matches.length, 200);
  assert.equal(big.truncated, true);

  const crowded = new FakeDir();
  for (let i = 0; i < 2001; i++) await put(crowded, `f${String(i).padStart(4, "0")}.txt`, "x");
  const r = await createTools(crowded).call("search_text", { query: "zzz" });
  assert.equal(r.files_scanned, 2000);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.matches, []);
});
