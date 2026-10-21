const KEY_LEN = 32;

function b64urlDecode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexDecode(s: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{64}$/.test(s)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function decodeKey(part: string): Uint8Array | null {
  if (/^[0-9a-fA-F]{64}$/.test(part)) return hexDecode(part);
  const raw = b64urlDecode(part);
  if (!raw || raw.length !== KEY_LEN) return null;
  return raw;
}

export function safeDownloadName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f]/g, "").replace(/^\.+/, "").slice(0, 80).trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "download.bin";
  return cleaned;
}

/**
 * `#<ck>` 或 `#<ck>.<文件名的 base64url>`。
 * ck 是 32 字节，用无填充 base64url，或 64 位十六进制。
 * 文件名留在 fragment 里，不发给服务器。
 */
export function parseFragment(hash: string): { key: Uint8Array; filename: string } | null {
  let raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.length > 2048) return null;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const dot = raw.indexOf(".");
  const keyPart = dot === -1 ? raw : raw.slice(0, dot);
  const namePart = dot === -1 ? "" : raw.slice(dot + 1);
  const key = decodeKey(keyPart);
  if (!key) return null;
  if (!namePart) return { key, filename: "download.bin" };
  const nameBytes = b64urlDecode(namePart);
  if (!nameBytes) return { key, filename: "download.bin" };
  let name = "";
  try {
    name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes);
  } catch {
    return { key, filename: "download.bin" };
  }
  return { key, filename: safeDownloadName(name) };
}
