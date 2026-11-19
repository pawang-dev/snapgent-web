import { createTools, TOOL_SCHEMAS } from "./core/fs-tools.js";
import { saveHandle, loadHandle } from "./core/handle-store.js";

const OPTIONS = { mode: "readwrite" };
const $ = (id) => document.getElementById(id);

let tools = null;
let pending = null; // saved handle that still needs the user's permission

function setStatus(state, text) {
  $("status").dataset.state = state;
  $("status").textContent = text;
  $("reconnect").hidden = state !== "needs-permission";
}

async function attach(handle) {
  if ((await handle.queryPermission(OPTIONS)) === "granted") {
    tools = createTools(handle);
    pending = null;
    setStatus("ready", `Connected to "${handle.name}".`);
  } else {
    tools = null;
    pending = handle;
    setStatus("needs-permission", `"${handle.name}" was selected before. Allow access to continue.`);
  }
}

async function run(name, args) {
  if (!tools) return { ok: false, error: "No folder is connected. Open the Snapgent panel and choose a folder." };
  try {
    return { ok: true, result: await tools.call(name, args) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

// Chat pages (content scripts, added later) send { type: "snapgent:tool", name, args }.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "snapgent:list") {
    sendResponse({ ok: true, result: TOOL_SCHEMAS });
    return false;
  }
  if (message?.type !== "snapgent:tool") return false;
  run(message.name, message.args).then(sendResponse);
  return true;
});

$("choose").addEventListener("click", async () => {
  try {
    const handle = await window.showDirectoryPicker(OPTIONS);
    await saveHandle(handle);
    await attach(handle);
  } catch (error) {
    if (error?.name !== "AbortError") setStatus("none", `Could not open the folder: ${error?.message ?? error}`);
  }
});

$("reconnect").addEventListener("click", async () => {
  if (pending && (await pending.requestPermission(OPTIONS)) === "granted") await attach(pending);
});

$("run").addEventListener("click", async () => {
  let args;
  try {
    args = JSON.parse($("args").value || "{}");
  } catch {
    $("output").textContent = "Arguments are not valid JSON.";
    return;
  }
  $("output").textContent = JSON.stringify(await run($("tool").value, args), null, 2);
});

for (const { name } of TOOL_SCHEMAS) $("tool").add(new Option(name, name));

loadHandle()
  .then((handle) => (handle ? attach(handle) : undefined))
  .catch((error) => setStatus("none", `Could not restore the folder: ${error?.message ?? error}`));
