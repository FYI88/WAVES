// Keep the div dialogs compatible with presentation fullscreen and Android Back.
export function containModal(dialog: HTMLElement) {
  const opener = document.activeElement as HTMLElement | null;
  const inert: Array<[HTMLElement, boolean]> = [];
  for (let branch: HTMLElement = dialog; branch.parentElement; branch = branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        inert.push([sibling, sibling.inert]);
        sibling.inert = true;
      }
    }
    if (branch.parentElement === document.body) break;
  }
  const bodyOverflow = document.body.style.overflow;
  const rootOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = document.documentElement.style.overflow = "hidden";
  const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, summary, [tabindex]',
  )).filter((node) => node.tabIndex >= 0 && !node.matches(':disabled, [hidden]') && node.getClientRects().length > 0);
  const focusStart = () => (dialog.querySelector<HTMLElement>('[data-modal-close]') ?? focusable()[0] ?? dialog).focus({ preventScroll: true });
  const onFocus = (event: FocusEvent) => {
    if (!dialog.contains(event.target as Node)) focusStart();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = focusable();
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? items.at(-1) : items[0])?.focus();
      if (!items.length) dialog.focus();
    }
  };
  document.addEventListener("focusin", onFocus);
  document.addEventListener("keydown", onKey);
  focusStart();
  return () => {
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("keydown", onKey);
    for (const [node, wasInert] of inert) node.inert = wasInert;
    document.body.style.overflow = bodyOverflow;
    document.documentElement.style.overflow = rootOverflow;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
}
