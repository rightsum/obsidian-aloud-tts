import { describe, expect, it } from "vitest";
import cleanMarkup from "./cleanMarkdown";
import { blankReferenceSections } from "./referenceSections";

describe("cleanMarkup reference noise", () => {
  it("drops footnote markers but keeps the sentence", () => {
    expect(
      cleanMarkup("Retries help.^([12](#fn-12)) Then [3](#fn-3) more."),
    ).toEqual("Retries help. Then  more.");
  });

  it("drops linked and escaped citation keys", () => {
    expect(
      cleanMarkup(
        "See [\\[Smi03\\]](bibliography.md#Smi03) and \\[Doe15a\\] for details.",
      ),
    ).toEqual("See  and  for details.");
  });

  it("drops urls but keeps ordinary link words", () => {
    expect(
      cleanMarkup(
        "Read [the guide](https://example.com/guide), [*https://example.org/x*](https://example.org/x) or https://example.net/a?b=1.",
      ),
    ).toEqual("Read the guide,  or .");
  });

  it("reads wiki links by alias or page name", () => {
    expect(
      cleanMarkup("Go to [[folder/Some Page#Intro]] or [[Other|this one]]."),
    ).toEqual("Go to Some Page Intro or this one.");
  });
});

describe("blankReferenceSections", () => {
  const doc = [
    "# Chapter",
    "Body text.",
    "## References",
    "- One source.",
    "### Sub list",
    "- Another source.",
    "## Next Section",
    "More body.",
  ].join("\n");

  it("blanks a references section up to the next heading of the same level", () => {
    const out = blankReferenceSections(doc);
    expect(out.length).toBe(doc.length);
    expect(out).toContain("Body text.");
    expect(out).toContain("## Next Section\nMore body.");
    expect(out).not.toContain("source");
    expect(out).not.toContain("Sub list");
  });

  it("recognizes numbered and emphasized reference headings", () => {
    expect(blankReferenceSections("# A. *Bibliography*\nx").trim()).toBe("");
    expect(blankReferenceSections("## 12. Notes\nx").trim()).toBe("");
  });

  it("blanks footnote definitions and bibliography entries anywhere", () => {
    const text = [
      "Keep me.",
      "[^1]: A footnote.",
      "^([7](#fn-7-marker))A converted footnote.",
      "- \\[Smi03\\] J. Smith, A Paper, 2003.",
      "[Doe15a] J. Doe, Another Paper.",
      "Keep me too.",
    ].join("\n");
    const lines = blankReferenceSections(text).split("\n");
    expect(lines[0]).toBe("Keep me.");
    expect(lines.slice(1, 5).every((l) => l.trim() === "")).toBe(true);
    expect(lines[5]).toBe("Keep me too.");
  });

  it("ignores headings inside code blocks", () => {
    const text = "```\n# References\n```\nStill read.";
    expect(blankReferenceSections(text)).toBe(text);
  });
});
