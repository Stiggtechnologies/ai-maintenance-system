// Stateless DOM lifecycle helper; no data collection, network or lead mutation.
export function bindModalFocus(
  dialog: HTMLElement,
  initialFocus: HTMLElement | null,
  onClose: () => void,
) {
  const document = dialog.ownerDocument;
  const trigger = document.activeElement as HTMLElement | null;
  const focusable = () =>
    [
      ...dialog.querySelectorAll<
        HTMLElement & { disabled?: boolean; type?: string }
      >("button, input, select, textarea, a[href], [tabindex]"),
    ].filter(
      (el) =>
        !el.disabled &&
        el.type !== "hidden" &&
        el.tabIndex >= 0 &&
        !el.hidden &&
        !el.closest("[hidden],[inert]"),
    );
  const focusFirst = () => {
    const target = initialFocus?.isConnected
      ? initialFocus
      : (focusable()[0] ?? dialog);
    target.focus();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    const first = items[0],
      last = items.at(-1)!;
    const active = document.activeElement;
    if (!first) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (active === last || !dialog.contains(active))
    ) {
      event.preventDefault();
      first.focus();
    }
  };
  const focusin = (event: FocusEvent) => {
    if (!dialog.contains(event.target as Node | null)) focusFirst();
  };
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("focusin", focusin, true);
  focusFirst();
  return () => {
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("focusin", focusin, true);
    if (trigger?.isConnected && typeof trigger.focus === "function")
      trigger.focus();
  };
}
