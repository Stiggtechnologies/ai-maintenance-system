import { test } from "vitest";
import assert from "node:assert/strict";
import { bindModalFocus } from "./modal-focus.ts";
function fixture() {
  document.body.innerHTML =
    '<button id="trigger">Request scope</button><a id="terms" href="/terms">Terms</a><section id="dialog" tabindex="-1"><button id="close">Close</button><form><input id="name" required minlength="2"><input type="hidden"><button id="send">Send</button></form></section>';
  const dom = {
    window: {
      KeyboardEvent,
      close: () => {
        document.body.innerHTML = "";
      },
    },
  };
  const d = document;
  d.getElementById("trigger")!.focus();
  return {
    dom,
    d,
    dialog: d.getElementById("dialog")!,
    name: d.getElementById("name")!,
  };
}
function press(
  dom: ReturnType<typeof fixture>["dom"],
  d: Document,
  key: string,
  shiftKey = false,
) {
  const e = new dom.window.KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  d.activeElement!.dispatchEvent(e);
  return e;
}
test("initial focus and ShiftTab wrap remain in dialog", () => {
  const { dom, d, dialog, name } = fixture();
  const dispose = bindModalFocus(dialog, name, () => {});
  assert.equal(d.activeElement, name);
  d.getElementById("close")!.focus();
  assert.equal(press(dom, d, "Tab", true).defaultPrevented, true);
  assert.equal(d.activeElement!.id, "send");
  dispose();
  dom.window.close();
});
test("forward Tab wraps and stray background focus is contained", () => {
  const { dom, d, dialog, name } = fixture();
  const dispose = bindModalFocus(dialog, name, () => {});
  d.getElementById("send")!.focus();
  press(dom, d, "Tab");
  assert.equal(d.activeElement!.id, "close");
  d.getElementById("terms")!.focus();
  assert.equal(d.activeElement, name);
  dispose();
  dom.window.close();
});
test("Escape invokes close and restores exact trigger", () => {
  const { dom, d, dialog, name } = fixture();
  let closes = 0;
  const dispose = bindModalFocus(dialog, name, () => {
    closes++;
    dispose();
  });
  press(dom, d, "Escape");
  assert.equal(closes, 1);
  assert.equal(d.activeElement!.id, "trigger");
  dom.window.close();
});
test("repeated open/cancel cleanup has no accumulated listeners", () => {
  const { dom, d, dialog, name } = fixture();
  let closes = 0;
  for (let i = 0; i < 4; i++) {
    d.getElementById("trigger")!.focus();
    const dispose = bindModalFocus(dialog, name, () => {
      closes++;
    });
    dispose();
    assert.equal(d.activeElement!.id, "trigger");
  }
  press(dom, d, "Escape");
  assert.equal(closes, 0);
  dom.window.close();
});
test("empty required form remains invalid without network submission", () => {
  const { dom, dialog } = fixture();
  assert.equal(dialog.querySelector("form")!.checkValidity(), false);
  dom.window.close();
});
