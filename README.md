# Snapgent Web

A Chrome extension that lets a normal AI chat page work on a local project folder. There is no API key and no local server: the extension reads and writes files directly through the browser's File System Access API.

Currently supports [claude.ai](https://claude.ai).

## How it works

1. You open the Snapgent panel (a tab owned by the extension) and choose a project folder.
2. On claude.ai, the **Insert instructions** button puts a short prompt into the message box. It tells Claude to answer with one JSON command per reply, for example `{"command":"read_file","params":{"path":"src/index.js"}}`.
3. When Claude finishes a reply that contains a command, the extension runs it against your folder through the panel tab.
4. The result is placed in the message box. You press send (or turn on automatic sending) and the loop continues.

## Install

There is no build step.

1. Clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.

## Use

1. Click the Snapgent icon. In the tab that opens, click **Choose folder** and accept the permission prompt. Keep this tab open.
2. Open a new chat on claude.ai. A **Snapgent** box appears at the bottom left.
3. Click **Insert instructions**, add your task, and send.
4. Follow the status text in the Snapgent box. For write commands a card asks you to **Run** or **Skip**.

After a browser restart the panel may ask for access again; click **Allow access again**.

You can also run any tool by hand from the panel tab, which is useful for testing.

## Tools

| Tool | What it does | Approval |
|---|---|---|
| `list_dir` | List files and folders | Runs automatically |
| `read_file` | Read a UTF-8 text file (up to 200 KB) | Runs automatically |
| `write_file` | Create or replace a file; parent folders are created | Asks first |
| `edit_file` | Replace an exact snippet; it must match once unless `replace_all` is set | Asks first |

## Safety

- All paths are relative to the folder you chose. Absolute paths and `..` are rejected, and nothing inside `.git` can be written.
- Write and edit commands never run without your click.
- **Whatever Claude reads is sent into the chat, and so to the AI provider.** Do not choose a folder that holds secrets. A `.env` file inside the folder can be read like any other file.
- Text from web pages or documents that you paste into a chat can try to steer the model. Read the command on the Run card before you click.
- Automatic sending is off by default. With it on, results are submitted without you looking at them first.
- There is no undo. Review changes with your editor and `git diff`.

## Limits

- Needs the File System Access API, so Chromium desktop browsers only. Tested in Chrome on Linux.
- claude.ai only. Its page selectors were checked by hand on 2026-11-19, but the site can change. They live in `SEL` at the top of `extension/content/claude.js`.
- No shell commands, test runner or git operations.
- The panel tab must stay open, and only one folder is connected at a time.
- Files over 200 KB and files that are not UTF-8 are not read.

## Development

```bash
npm test
```

Needs Node 22 or newer. The tests cover path handling, the file tools (against an in-memory folder) and the command protocol. Anything that touches a real browser page is tested by hand.

```
extension/
  manifest.json
  background.js          opens the panel
  panel.html, panel.js   folder picker and message handler
  core/                  path rules, file tools, folder-handle storage
  content/               protocol (parse, prompt, results) and the claude.js page script
tests/
```

Changes go through pull requests: squash merge, conventional commit titles and a passing `ci` check.

## Credits and license

Inspired by [snapgent-connector](https://github.com/herdodp/snapgent-connector). This is an independent rewrite without its local bridge. It reuses that project's tool names, and the claude.ai page selectors were first taken from its provider.

MIT. See [LICENSE](LICENSE).
