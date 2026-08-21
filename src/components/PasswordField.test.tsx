import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordField } from "./PasswordField";

describe("PasswordField", () => {
  it("keeps the password hidden by default and reveals it on demand", () => {
    render(
      <PasswordField
        aria-label="Password"
        id="test-password"
        value="CorrectHorseBatteryStaple"
        readOnly
      />,
    );

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("CorrectHorseBatteryStaple");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("uses a field-specific accessible label when requested", () => {
    render(
      <PasswordField
        aria-label="Confirm new password"
        id="confirm-password"
        visibilityName="confirmed password"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show confirmed password" }),
    ).toHaveAttribute("aria-controls", "confirm-password");
  });
});
