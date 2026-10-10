import { expect, it } from "vitest";
import { safeAuthReturnTo } from "./auth-return";
it("preserves same-origin case, query and fragment without widening the existing return policy", () => {
  const origin = "https://app.example.test";
  const path =
    "/workspace/cases/draft-1?industry=mining&source=marketplace#evidence";
  expect(safeAuthReturnTo(path, origin)).toBe(path);
  for (const rejected of [
    "https://evil.test/path",
    "//evil.test/path",
    "/\\evil.test/path",
    "javascript:alert(1)",
    "/signin?returnTo=/signin",
    null,
  ])
    expect(safeAuthReturnTo(rejected, origin)).toBe("/");
  expect(safeAuthReturnTo(null, origin, "/start")).toBe("/start");
});
