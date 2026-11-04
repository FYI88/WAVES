import { shareDataUrl, shareText } from "./native";

/** Best-effort clipboard write with a legacy fallback (non-secure contexts). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Download helper for generated files (PNG snapshots, CSV tables). */
export async function downloadFile(href: string, filename: string): Promise<void> {
  if (href.startsWith("data:image/png")) {
    try {
      if (await shareDataUrl(href, filename)) return;
    } catch {
      // Keep the browser download fallback if native sharing fails.
    }
  }
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download generated CSV text through a temporary object URL. */
export async function downloadText(text: string, filename: string): Promise<void> {
  try {
    if (await shareText(text, filename)) return;
  } catch {
    // Keep the browser download fallback if native sharing fails.
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  downloadFile(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
