export function encodeSubmitKey(submitKey = "Enter") {
  const key = typeof submitKey === "string" ? submitKey.toLowerCase() : "";
  if (key !== "enter" && key !== "shift+enter") {
    throw new Error(`Unsupported submitKey: ${submitKey}`);
  }
  return key;
}
