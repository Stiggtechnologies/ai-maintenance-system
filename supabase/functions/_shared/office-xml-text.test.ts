import { describe, expect, it } from "vitest";
import { stripXmlMarkup } from "./office-xml-text";

describe("stripXmlMarkup", () => {
  it("keeps the text of a well-formed run", () => {
    expect(stripXmlMarkup('<w:t xml:space="preserve">Pump bearing</w:t>')).toBe(
      "Pump bearing",
    );
    expect(stripXmlMarkup("<a:t>Slide text</a:t>")).toBe("Slide text");
    expect(stripXmlMarkup("<w:t>temp &lt; 80</w:t>")).toBe("temp &lt; 80");
  });

  it("removes nested and unterminated tags", () => {
    for (const sample of [
      "<scr<script>ipt>",
      "<scr<x>ipt>",
      "<<script>script>",
      "<script",
      "<w:t><script>alert(1)</script></w:t>",
    ]) {
      const text = stripXmlMarkup(sample);
      expect(text, sample).not.toMatch(/[<>]/);
      expect(text.toLowerCase(), sample).not.toContain("<script");
    }
  });
});
