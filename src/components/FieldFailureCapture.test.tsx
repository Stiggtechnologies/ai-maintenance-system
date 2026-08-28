/**
 * Field failure capture — E6.13 first slice. The fieldCapture service is
 * mocked (governed-RPC/storage invariants are pinned in the migration
 * contract below); these assertions pin the mobile flow: type chips ->
 * description -> camera photo -> governed submit -> photo attached.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldFailureCapture } from "./FieldFailureCapture";
import { readFileSync } from "node:fs";

const reportFailure = vi.fn();

vi.mock("../services/fieldCapture", () => ({
  reportFailure: (...args: unknown[]) => reportFailure(...(args as [never])),
  assetQrDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,QR"),
}));

const noopFile = () =>
  new File(["jpeg-bytes"], "field-photo.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FieldFailureCapture", () => {
  it("renders the big-button mobile flow", () => {
    render(<FieldFailureCapture assetId="a-1" assetTag="T301" />);
    expect(screen.getByText("Report failure from the field")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fault" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /File fault report — T301/ }),
    ).toBeTruthy();
  });

  it("refuses a report with no observation", async () => {
    render(<FieldFailureCapture assetId="a-1" />);
    fireEvent.click(screen.getByRole("button", { name: /File fault report/ }));
    expect(
      await screen.findByText(/no observation is not a report/i),
    ).toBeTruthy();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("files the governed report with the camera photo attached", async () => {
    reportFailure.mockResolvedValue({
      notificationId: "n-1",
      photoPath: "org/n-1/p.jpg",
    });
    render(<FieldFailureCapture assetId="a-1" assetTag="T301" />);

    fireEvent.click(screen.getByRole("button", { name: "Safety" }));
    fireEvent.change(screen.getByPlaceholderText(/What did you observe/i), {
      target: {
        value: "Hydraulic leak at the boom joint — fluid loss visible",
      },
    });
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [noopFile()] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /File safety report — T301/ }),
    );

    await waitFor(() => expect(reportFailure).toHaveBeenCalledTimes(1));
    const input = reportFailure.mock.calls[0][0] as Record<string, unknown>;
    expect(input.notificationType).toBe("safety");
    expect(input.photo).toBeDefined();
    expect(await screen.findByText(/photo attached as evidence/i)).toBeTruthy();
  });

  it("surfaces governed-path errors without losing the report", async () => {
    reportFailure.mockRejectedValue(
      new Error("choose the equipment this was observed on"),
    );
    render(<FieldFailureCapture assetId="a-1" />);
    fireEvent.change(screen.getByPlaceholderText(/What did you observe/i), {
      target: { value: "Something observed on the line" },
    });
    fireEvent.click(screen.getByRole("button", { name: /File fault report/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /choose the equipment/i,
    );
  });

  it("pins the governed migration contract", () => {
    const migration = readFileSync(
      "supabase/migrations/20261115090710_field_failure_capture.sql",
      "utf8",
    );
    expect(migration).toContain("bucket_id = 'failure-evidence'");
    expect(migration).toContain(
      "(storage.foldername(name))[1] = public.app_current_org()::text",
    );
    expect(migration).toContain(
      "create or replace function public.attach_failure_photo",
    );
    expect(migration).toContain(
      "create table if not exists public.failure_report_photos",
    );
    // Direct writes to the photo register stay closed.
    expect(migration).toContain("enable row level security");
    expect(migration).not.toMatch(
      /create policy failure_report_photos_(insert|update|delete)/,
    );
    expect(migration).toContain(
      "revoke execute on function public.attach_failure_photo",
    );
  });
});
