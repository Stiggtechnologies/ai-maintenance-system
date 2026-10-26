import { describe, expect, it } from "vitest";
import { edgeFunctionErrorMessage } from "./edgeFunctionError";

describe("edgeFunctionErrorMessage", () => {
  const httpError = (body: string, contentType = "application/json") =>
    Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(body, { status: 403, headers: { "Content-Type": contentType } }),
    });

  it("surfaces the governed refusal reason from the function body", async () => {
    await expect(
      edgeFunctionErrorMessage(httpError(JSON.stringify({ error: "workspace invitation requires an AAL2 session" }))),
    ).resolves.toBe("workspace invitation requires an AAL2 session");
  });

  it("keeps the transport message when the body has no reason", async () => {
    await expect(edgeFunctionErrorMessage(httpError("<html>gateway</html>", "text/html"))).resolves.toBe(
      "Edge Function returned a non-2xx status code",
    );
    await expect(edgeFunctionErrorMessage(new Error("network down"))).resolves.toBe("network down");
    await expect(edgeFunctionErrorMessage(null)).resolves.toBe("Edge Function request failed");
  });
});
