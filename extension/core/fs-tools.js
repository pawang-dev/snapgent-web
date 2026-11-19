// File tools over a FileSystemDirectoryHandle. Names and parameters follow
// vscode_mcp.py in snapgent-connector so a future prompt/parser can stay the same.
import { splitPath, touchesGit } from "./path.js";

export const MAX_FILE_BYTES = 200_000;

const STR = { type: "string" };
export const TOOL_SCHEMAS = [
  { name: "list_dir", description: "List files and folders in the selected folder.", inputSchema: { type: "object", properties: { path: STR } } },
  { name: "read_file", description: "Read a UTF-8 text file.", inputSchema: { type: "object", properties: { path: STR }, required: ["path"] } },
  { name: "write_file", description: "Write or replace a UTF-8 text file. Parent folders are created.", inputSchema: { type: "object", properties: { path: STR, content: STR }, required: ["path", "content"] } },
  {
    name: "edit_file",
    description: "Replace an exact text snippet; by default the snippet must be unique.",
    inputSchema: { type: "object", properties: { path: STR, old_text: STR, new_text: STR, replace_all: { type: "boolean" } }, required: ["path", "old_text", "new_text"] },
  },
];

async function getDir(root, parts, create = false) {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

function friendly(error, path) {
  if (error && (error.name === "NotFoundError" || error.name === "TypeMismatchError")) {
    return new Error(`Not found, or wrong type (file vs folder): ${path}`);
  }
  return error;
}

function fileParts(path) {
  const parts = splitPath(path);
  if (parts.length === 0) throw new Error("A file path is required.");
  return parts;
}

async function readText(root, path) {
  const parts = fileParts(path);
  const name = parts.pop();
  let file;
  try {
    const dir = await getDir(root, parts);
    file = await (await dir.getFileHandle(name)).getFile();
  } catch (error) {
    throw friendly(error, path);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is ${file.size} bytes; the limit is ${MAX_FILE_BYTES}.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error(`Not a UTF-8 text file: ${path}`);
  }
}

async function writeText(root, path, content) {
  const parts = fileParts(path);
  if (touchesGit(parts)) throw new Error("Refusing to write inside .git.");
  const name = parts.pop();
  const dir = await getDir(root, parts, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export function createTools(root) {
  const tools = {
    async list_dir({ path = "" } = {}) {
      const parts = splitPath(path);
      let dir;
      try {
        dir = await getDir(root, parts);
      } catch (error) {
        throw friendly(error, path);
      }
      const entries = [];
      for await (const [name, handle] of dir.entries()) {
        entries.push({ name, type: handle.kind === "directory" ? "dir" : "file" });
      }
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      return { path: parts.join("/") || ".", entries };
    },

    async read_file({ path } = {}) {
      return { path, content: await readText(root, path) };
    },

    async write_file({ path, content } = {}) {
      if (typeof content !== "string") throw new Error("content must be a string.");
      await writeText(root, path, content);
      return { path, bytes: new TextEncoder().encode(content).length };
    },

    async edit_file({ path, old_text, new_text, replace_all = false } = {}) {
      if (typeof old_text !== "string" || old_text === "") throw new Error("old_text must be a non-empty string.");
      if (typeof new_text !== "string") throw new Error("new_text must be a string.");
      const text = await readText(root, path);
      const count = text.split(old_text).length - 1;
      if (count === 0) throw new Error("old_text was not found.");
      if (count > 1 && !replace_all) {
        throw new Error(`old_text matches ${count} places; make it unique or set replace_all.`);
      }
      await writeText(root, path, text.split(old_text).join(new_text));
      return { path, replaced: count };
    },
  };

  return {
    names: Object.keys(tools),
    async call(name, args) {
      if (!Object.hasOwn(tools, name)) throw new Error(`Unknown tool "${name}". Valid: ${Object.keys(tools).join(", ")}.`);
      return tools[name](args ?? {});
    },
  };
}
