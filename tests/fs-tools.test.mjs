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
