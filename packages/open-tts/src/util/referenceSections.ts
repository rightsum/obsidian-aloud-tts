const REFERENCE_HEADING =
  /^(bibliography|references|reference list|works cited|sources|citations|footnotes|endnotes|notes|further reading)$/i;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
// footnote definitions: [^1]: text, or converted footnotes like ^([12](#fn-12-marker))text
const FOOTNOTE_DEFINITION = /^\s*(\[\^[^\]]+\]:|\^\(\s*\[\d+\]\(#)/;
// bibliography entries such as "- \[Ada15\] B. Adams, ..." or "[Ada15] ..."
const BIBLIOGRAPHY_ENTRY =
  /^\s*(?:[-*+]\s+|\d+\.\s+)?\\?\[[A-Za-z][\w.+-]*\d{2,4}[a-z]?\\?\]\s+\S/;

function headingTitle(raw: string): string {
  return raw
    .replace(/[*_`~=]/g, "")
    .replace(/^(?:[A-Z]|\d+(?:\.\d+)*)[.)]\s+/, "")
    .trim();
}

/** Replaces every character except newlines with a space, keeping offsets intact */
function blank(line: string): string {
  return line.replace(/[^\n]/g, " ");
}

/**
 * Blanks out reference material so it isn't read aloud: sections headed e.g.
 * "Bibliography" or "References" (up to the next heading of the same or higher
 * level), footnote definitions, and bibliography entries. Offsets are preserved
 * so highlighting stays aligned with the document.
 */
export function blankReferenceSections(text: string): string {
  const lines = text.split("\n");
  let skipLevel: number | undefined;
  let inCodeBlock = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCodeBlock = !inCodeBlock;
      }
      const heading = !inCodeBlock ? HEADING.exec(line) : null;
      if (heading) {
        const level = heading[1].length;
        if (skipLevel !== undefined && level <= skipLevel) {
          skipLevel = undefined;
        }
        if (
          skipLevel === undefined &&
          REFERENCE_HEADING.test(headingTitle(heading[2]))
        ) {
          skipLevel = level;
        }
      }
      if (skipLevel !== undefined) {
        return blank(line);
      }
      if (
        !inCodeBlock &&
        (FOOTNOTE_DEFINITION.test(line) || BIBLIOGRAPHY_ENTRY.test(line))
      ) {
        return blank(line);
      }
      return line;
    })
    .join("\n");
}
