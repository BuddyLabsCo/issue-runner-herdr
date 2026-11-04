export function encodeSubmitKey(submitKey = "Enter") {
  const key = typeof submitKey === "string" ? submitKey.toLowerCase() : "";
  if (key !== "enter" && key !== "shift+enter") {
    throw new Error(`Unsupported submitKey: ${submitKey}`);
  }
  return key;
}

const namedKeys = new Set([
  "space",
  "enter",
  "return",
  "esc",
  "escape",
  "tab",
  "backspace",
  "bs",
  "left",
  "right",
  "up",
  "down",
  "minus",
  "comma",
  "period",
  "slash",
  "backslash",
  "quote",
  "double_quote",
  "double-quote",
  "semicolon",
  "colon",
  "percent",
  "ampersand",
  "backtick",
  "plus",
]);

export function encodeKeys(keys: readonly string[]): string[] {
  if (!Array.isArray(keys))
    throw new Error("sendKeys requires an array of logical chords");
  return Array.from(keys, (key: unknown) => {
    if (typeof key !== "string" || !key || /[\s\p{Cc}\p{Cs}]/u.test(key))
      throw new Error(`Unsupported logical key chord: ${String(key)}`);
    const parts =
      key === "+"
        ? ["plus"]
        : key.endsWith("++")
          ? [...key.slice(0, -2).split("+"), "plus"]
          : key.split("+");
    const base = parts.pop()!;
    const modifiers = parts.map((part) => part.toLowerCase());
    if (
      !modifiers.every((part) =>
        /^(ctrl|control|shift|alt|option|meta|cmd|command|super|hyper)$/.test(
          part,
        ),
      )
    )
      throw new Error(`Unsupported logical key chord: ${key}`);
    const lower = base.toLowerCase();
    if (
      !namedKeys.has(lower) &&
      Array.from(base).length !== 1 &&
      !/^f(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(lower)
    )
      throw new Error(`Unsupported logical key chord: ${key}`);
    return [
      ...modifiers,
      namedKeys.has(lower) || /^f[0-9]+$/.test(lower) ? lower : base,
    ].join("+");
  });
}
