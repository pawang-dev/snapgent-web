// Content script for claude.ai. A classic script: protocol.js is loaded before it.
// The selectors in SEL were read from the snapgent-connector provider (snapshot
// Nov 2026) and are NOT verified against the live site. If the page changes, fix SEL only.
(() => {
  const P = globalThis.SnapgentProtocol;
  if (!P || document.getElementById("snapgent-bar")) return;

  const SEL = {
    user: '[data-testid="user-message"]',
    assistant: '[data-testid="assistant-message"]',
    editor: ['[data-testid="chat-input"] [contenteditable]', ".ProseMirror[contenteditable]", "div[contenteditable]"],
    send: ['button[aria-label*="Send"]', 'button[data-testid*="send"]'],
    stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => el.getClientRects().length > 0;

  function find(selectors, accept = () => true) {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) if (visible(el) && accept(el)) return el;
    }
    return null;
  }
  const findEditor = () => find(SEL.editor, (el) => !el.closest(`${SEL.user}, ${SEL.assistant}, #snapgent-bar`));
  const lastAssistant = () => [...document.querySelectorAll(SEL.assistant)].pop() ?? null;

  // ---- UI (shadow DOM keeps the page's CSS out) ----
  const host = document.createElement("div");
  host.id = "snapgent-bar";
  const ui = host.attachShadow({ mode: "open" });
  ui.innerHTML = `
    <style>
      :host { all: initial; }
      .box { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; width: 280px; box-sizing: border-box;
        font: 13px/1.4 system-ui, sans-serif; color-scheme: light dark; background: Canvas; color: CanvasText;
        border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius: 8px; padding: 10px; }
      p { margin: .25rem 0 .5rem; }
      button { font: inherit; padding: .25rem .6rem; cursor: pointer; }
      button:focus-visible, input:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
      label { display: block; margin-top: .5rem; }
      pre { max-height: 10rem; overflow: auto; white-space: pre-wrap; margin: .25rem 0 .5rem; }
    </style>
    <div class="box">
      <strong>Snapgent</strong>
      <p id="status" role="status">Ready.</p>
      <button id="insert" type="button">Insert instructions</button>
      <label><input id="auto" type="checkbox"> Send results automatically</label>
      <div id="confirm" hidden>
        <p>Allow this command?</p>
        <pre id="what"></pre>
        <button id="run" type="button">Run</button>
        <button id="skip" type="button">Skip</button>
      </div>
    </div>`;
  document.documentElement.append(host);
  const $ = (id) => ui.getElementById(id);
  const setStatus = (text) => { $("status").textContent = text; };

  function confirmRun(cmd) {
    const clip = (_key, value) => (typeof value === "string" && value.length > 200 ? `${value.slice(0, 200)}… (${value.length} chars)` : value);
    $("what").textContent = `${cmd.command}\n${JSON.stringify(cmd.params, clip, 2)}`;
    $("confirm").hidden = false;
    $("run").focus();
    return new Promise((resolve) => {
      const done = (ok) => { $("confirm").hidden = true; $("run").onclick = null; $("skip").onclick = null; resolve(ok); };
      $("run").onclick = () => done(true);
      $("skip").onclick = () => done(false);
    });
  }

  // ---- Talking to the panel tab ----
  async function callPanel(message) {
    try {
      return (await chrome.runtime.sendMessage(message)) ?? { ok: false, error: "The Snapgent panel did not answer." };
    } catch {
      return { ok: false, error: "The Snapgent panel is not open. Open its tab, choose a folder, then try again." };
    }
  }

  // ---- Composer ----
  async function insertText(text) {
    const editor = findEditor();
    if (!editor) return false;
    editor.focus();
    const selection = getSelection();
    selection.selectAllChildren(editor);
    selection.collapseToEnd();
    const before = (editor.textContent ?? "").length;
    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    } catch { /* fall through to execCommand */ }
    await sleep(150);
    if ((editor.textContent ?? "").length > before) return true;
    document.execCommand("insertText", false, text);
    await sleep(150);
    return (editor.textContent ?? "").length > before;
  }

  async function send() {
    for (let i = 0; i < 10; i++) {
      const button = find(SEL.send);
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") { button.click(); return true; }
      await sleep(200);
    }
    return false;
  }

  // ---- Commands ----
  async function handleReply() {
    await sleep(300); // let the last tokens render
    const item = lastAssistant();
    if (!item) return;
    const cmd = P.findCommand([...item.querySelectorAll("pre")].map((el) => el.textContent));
    if (!cmd) { setStatus("Ready."); return; }

    let response;
    if (P.needsConfirm(cmd.command) && !(await confirmRun(cmd))) {
      response = { ok: false, error: "The user skipped this command." };
    } else {
      setStatus(`Running ${cmd.command}…`);
      response = await callPanel({ type: "snapgent:tool", name: cmd.command, args: cmd.params });
    }

    const text = P.formatResult(cmd.command, response);
    if (!(await insertText(text))) {
      console.warn(`[snapgent] Could not fill the message box. Result:\n${text}`);
      setStatus("Could not fill the message box. See the console.");
      return;
    }
    const outcome = response.ok ? `${cmd.command} done.` : `${cmd.command} failed: ${response.error}`;
    if ($("auto").checked) setStatus((await send()) ? `${outcome} Result sent.` : `${outcome} Press send.`);
    else setStatus(`${outcome} The result is in the message box; press send.`);
  }

  $("insert").addEventListener("click", async () => {
    const response = await callPanel({ type: "snapgent:list" });
    if (!response.ok) { setStatus(response.error); return; }
    setStatus((await insertText(P.buildPrompt(response.result))) ? "Instructions inserted. Add your task and send." : "Could not fill the message box.");
  });

  // Act only on a reply that finished while this page was open: that is a stop
  // button appearing and then going away. Nothing runs on page load or on old chats.
  let sawGeneration = false;
  let busy = false;
  setInterval(async () => {
    if (find(SEL.stop)) { sawGeneration = true; return; }
    if (!sawGeneration || busy) return;
    sawGeneration = false;
    busy = true;
    try { await handleReply(); } finally { busy = false; }
  }, 500);
})();
