import { describe, expect, it } from "vitest";
import { excerptAround, extractJsonObject, parseLooseJson } from "./json";

/** Narrows to the success branch so tests can read `.value` without casting. */
function parsed(text: string) {
  const result = parseLooseJson(text);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`);
  return result;
}

describe("parseLooseJson", () => {
  it("parses clean JSON without claiming to have repaired anything", () => {
    const result = parsed('{"title":"Hi","shots":[1,2]}');
    expect(result.value).toEqual({ title: "Hi", shots: [1, 2] });
    expect(result.repairs).toEqual([]);
  });

  it("reads through a markdown fence", () => {
    expect(parsed('```json\n{"a":1}\n```').value).toEqual({ a: 1 });
  });

  it("reads through a sentence before and after the object", () => {
    expect(parsed('Sure! Here is the plan:\n{"a":1}\nLet me know if you want changes.').value).toEqual({ a: 1 });
  });

  it("is not fooled by a brace inside a string value", () => {
    // indexOf/lastIndexOf scanning would cut this in the wrong place.
    expect(parsed('{"note":"use {curly} braces","b":2}').value).toEqual({ note: "use {curly} braces", b: 2 });
  });

  it("recovers an unescaped quote inside a value — the failure that killed the run", () => {
    // The real reply: a shot description containing an inch mark, which closes
    // the string four thousand characters into an otherwise perfect plan.
    const result = parsed('{"visual":"a 6" tall Laddu Gopal idol","index":1}');
    expect(result.value).toEqual({ visual: 'a 6" tall Laddu Gopal idol', index: 1 });
    expect(result.repairs.join(" ")).toContain("unescaped quotes");
  });

  it("recovers several unescaped quotes in one document", () => {
    const result = parsed('{"a":"he said "hi" to her","b":"and "bye" after"}');
    expect(result.value).toEqual({ a: 'he said "hi" to her', b: 'and "bye" after' });
  });

  it("recovers a trailing comma", () => {
    expect(parsed('{"a":1,"b":[1,2,],}').value).toEqual({ a: 1, b: [1, 2] });
  });

  it("recovers typographic quotes from a reply written as prose", () => {
    expect(parsed('{“a”:“one”}').value).toEqual({ a: "one" });
  });

  it("recovers a raw newline inside a string", () => {
    expect(parsed('{"a":"line one\nline two"}').value).toEqual({ a: "line one\nline two" });
  });

  it("keeps a long realistic plan intact while fixing only the broken value", () => {
    const plan = {
      title: "Janmashtami Divine Celebration",
      aspectRatio: "9:16",
      continuityLock: "Same lead across all clips.",
      shots: [
        { index: 1, visual: "temple at dawn", durationSeconds: 8 },
        { index: 2, visual: "PLACEHOLDER", durationSeconds: 8 },
      ],
    };
    const broken = JSON.stringify(plan).replace('"PLACEHOLDER"', '"a 6" tall idol on a jhula"');
    const result = parsed(broken);
    const value = result.value as typeof plan;
    expect(value.title).toBe("Janmashtami Divine Celebration");
    expect(value.shots).toHaveLength(2);
    expect(value.shots[1]!.visual).toBe('a 6" tall idol on a jhula');
    expect(value.shots[0]!.visual).toBe("temple at dawn");
  });

  it("says plainly when the reply was cut off mid-value", () => {
    // This is what reading a streamed reply too early looks like, and it needs
    // a different fix from a malformed value — so it is reported differently.
    const result = parseLooseJson('{"title":"Janmashtami","shots":[{"visual":"temple at daw');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.truncated).toBe(true);
  });

  it("does not call a merely malformed reply truncated", () => {
    const result = parseLooseJson('{"a": : 1}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.truncated).toBe(false);
  });

  it("reports an empty reply as empty rather than as bad JSON", () => {
    const result = parseLooseJson("   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/empty/i);
  });

  it("reports a reply with no JSON at all", () => {
    const result = parseLooseJson("I can't help with that, sorry.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/No JSON object/);
  });

  it("points at where the failure is, not at the start of the reply", () => {
    // The beginning of a broken reply is the one part guaranteed to look fine,
    // so an excerpt taken from position 0 tells a human nothing.
    const filler = "x".repeat(3000);
    const result = parseLooseJson(`{"pad":"${filler}","a": : 1}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.excerpt).toContain("❭HERE❬");
    expect(result.excerpt.length).toBeLessThan(600);
  });
});

describe("extractJsonObject", () => {
  it("prefers a fenced block over surrounding chatter", () => {
    expect(extractJsonObject('blah {"decoy":1} blah\n```json\n{"real":2}\n```')).toBe('{"real":2}');
  });

  it("returns the unterminated remainder so a truncation can still be diagnosed", () => {
    expect(extractJsonObject('here you go {"a":1')).toBe('{"a":1');
  });

  it("returns null when there is no JSON at all", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("excerptAround", () => {
  it("marks the failure point inside the surrounding text", () => {
    expect(excerptAround("abcdefghij", 5, 2)).toBe("…de❭HERE❬fg…");
  });

  it("falls back to the head of the text when there is no position", () => {
    expect(excerptAround("abcdefghij", undefined, 3)).toBe("abcdef");
  });
});
