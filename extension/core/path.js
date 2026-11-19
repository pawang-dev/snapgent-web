// Pure path helpers. Every tool path is relative to the folder the user chose.

export function splitPath(input) {
  const raw = String(input ?? "").replace(/\\/g, "/").trim();
  if (/^(?:[a-zA-Z]:)?\//.test(raw)) {
    throw new Error(`Use a path relative to the selected folder: ${input}`);
  }
  const parts = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new Error(`Path escapes the selected folder: ${input}`);
    parts.push(segment);
  }
  return parts;
}

export function touchesGit(parts) {
  return parts.some((part) => part.toLowerCase() === ".git");
}
