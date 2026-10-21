import { decryptBlob } from "./frame.ts";
import { parseFragment } from "./fragment.ts";

const MAX_BYTES = 100 * 1024 * 1024;

function message(error: string | undefined, status: number, retryAfter?: number): string {
  if (error === "bad_code" || status === 401) return "取件码不正确";
  if (error === "locked" || status === 423) {
    const mins = retryAfter ? Math.max(1, Math.ceil(retryAfter / 60)) : 15;
    return `尝试过多，请约 ${mins} 分钟后再试`;
  }
  if (error === "expired" || status === 410) return "链接已过期";
  if (error === "not_found" || status === 404) return "链接不存在或已失效";
  if (status === 400) return "请输入 6 位数字取件码";
  return "下载失败，请稍后再试";
}

function saveBlob(bytes: Uint8Array, filename: string): void {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function start(): void {
  const form = document.querySelector<HTMLFormElement>("#pick");
  const input = document.querySelector<HTMLInputElement>("#code");
  const error = document.querySelector<HTMLElement>("#error");
  const button = document.querySelector<HTMLButtonElement>("#go");
  if (!form || !input || !error || !button) return;
  const formEl: HTMLFormElement = form;
  const inputEl: HTMLInputElement = input;
  const errorEl: HTMLElement = error;
  const buttonEl: HTMLButtonElement = button;
  const slug = document.body.dataset.slug ?? "";
  if (!/^[0-9A-Za-z]{10}$/.test(slug)) return;
  formEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit();
  });

  async function submit(): Promise<void> {
    errorEl.textContent = "";
    const parsed = parseFragment(globalThis.location.hash);
    if (!parsed) {
      errorEl.textContent = "这条链接不完整。请让对方重新复制完整链接（井号后面的内容也要保留）。";
      return;
    }
    const code = inputEl.value.trim();
    if (!/^\d{6}$/.test(code)) {
      errorEl.textContent = "请输入 6 位数字取件码";
      return;
    }
    buttonEl.disabled = true;
    try {
      const res = await fetch("/api/" + slug, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("application/octet-stream")) {
        const data = (await res.json().catch(() => null)) as { error?: string; retryAfter?: number } | null;
        errorEl.textContent = message(data?.error, res.status, data?.retryAfter);
        buttonEl.disabled = res.status === 404 || res.status === 410;
        return;
      }
      const total = Number(res.headers.get("content-length") ?? "");
      const raw = new Uint8Array(await res.arrayBuffer());
      if ((Number.isFinite(total) && total > MAX_BYTES) || raw.byteLength > MAX_BYTES) {
        throw new Error("size");
      }
      const plain = decryptBlob(raw, parsed.key);
      saveBlob(plain, parsed.filename);
      const left = res.headers.get("x-locker-pulls-left");
      const burned = res.headers.get("x-locker-burned");
      if (burned === "1" || left === "0") errorEl.textContent = "文件已下载，链接已失效。";
      else if (left) errorEl.textContent = `下载已开始，还剩 ${left} 次。`;
      else errorEl.textContent = "下载已开始。";
    } catch {
      errorEl.textContent = "无法解密。请确认链接完整。若这是一次性链接，次数可能已经用掉。";
      buttonEl.disabled = false;
    } finally {
      parsed.key.fill(0);
    }
  }
}

start();