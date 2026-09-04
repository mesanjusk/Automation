/**
 * Lenient JSON extraction for text produced by a language model.
 *
 * A model asked for "strict JSON only" mostly complies, and the ways it fails
 * are boringly consistent: a markdown fence around the object, a sentence
 * before it, a trailing comma, typographic quotes, or — the one that actually
 * bites on long outputs — an unescaped `"` inside a string value, so the JSON
 * parses perfectly for four thousand characters and then falls over mid-shot.
 *
 * None of that is a reason to throw away a plan the model got substantively
 * right, so these repairs are attempted in order and each is kept only if it
 * makes the text parse. Anything genuinely unrecoverable (most importantly a
 * reply that was read while it was still being written) is reported as such,
 * with the text around the failure rather than the first 900 characters — the
 * beginning of a truncated reply is the one part guaranteed to look fine.
 */

export interface LooseJsonSuccess {
  ok: true;
  value: unknown;
  /** Which repairs, if any, had to be applied. Empty means it parsed as sent. */
  repairs: string[];
}

export interface LooseJsonFailure {
  ok: false;
  error: string;
  /** Byte offset the parser gave up at, when it gave one. */
  position?: number;
  /** The text around `position`, which is where a human needs to look. */
  excerpt: string;
  /** The reply stopped mid-value — it was almost certainly read too early. */
  truncated: boolean;
}

export type LooseJsonResult = LooseJsonSuccess | LooseJsonFailure;

const MAX_QUOTE_REPAIRS = 60;

export function parseLooseJson(text: string): LooseJsonResult {
  const source = (text ?? "").trim();
  if (!source) {
    return { ok: false, error: "The reply was empty.", excerpt: "", truncated: false };
  }

  const candidate = extractJsonObject(source);
  if (!candidate) {
    return {
      ok: false,
      error: "No JSON object was found in the reply.",
      excerpt: source.slice(0, 400),
      truncated: false,
    };
  }

  const repairs: string[] = [];
  let working = candidate;

  const attempt = (): LooseJsonSuccess | null => {
    try {
      return { ok: true, value: JSON.parse(working), repairs: [...repairs] };
    } catch {
      return null;
    }
  };

  const asIs = attempt();
  if (asIs) return asIs;

  for (const repair of [stripTrailingCommas, straightenQuotes, escapeControlCharacters]) {
    const next = repair(working);
    if (next.text === working) continue;
    const before = working;
    working = next.text;
    const parsed = attempt();
    if (parsed) {
      repairs.push(next.name);
      return { ...parsed, repairs };
    }
    // Keep the repair only if it moved the failure later in the string;
    // otherwise it made things worse and is rolled back.
    if (failurePosition(working) > failurePosition(before)) repairs.push(next.name);
    else working = before;
  }

  // The remaining likely cause is a quote inside a value that the model forgot
  // to escape, which closes the string early. The parser points straight at the
  // character it did not expect, so the offending quote is the one just before
  // it; escape that and ask again, as many times as there are stray quotes.
  const beforeQuoteRepairs = working;
  for (let i = 0; i < MAX_QUOTE_REPAIRS; i++) {
    const position = failurePosition(working);
    if (position < 0) break;
    const repaired = escapeQuoteBefore(working, position);
    if (!repaired) break;
    working = repaired;
    const parsed = attempt();
    if (parsed) {
      repairs.push("escaped unescaped quotes inside string values");
      return { ...parsed, repairs };
    }
  }

  // These repairs shift every offset after the first inserted backslash, so a
  // failure reported against the patched text would point a human at the wrong
  // place — and at backslashes nobody wrote. Report on the text as received.
  return describeFailure(beforeQuoteRepairs);
}

function failurePosition(text: string): number {
  try {
    JSON.parse(text);
    return -1;
  } catch (err) {
    return positionOf(err as Error, text) ?? -1;
  }
}

/**
 * Where the parser gave up.
 *
 * V8 reports this two different ways and only one of them carries an offset:
 * `…in JSON at position 4007` for most syntax errors, but
 * `Unexpected token ':', ..."<snippet>" is not valid JSON` for others. The
 * second form is located by finding its snippet back in the source, so a
 * failure is always pointed at rather than described from the top of the file.
 */
function positionOf(err: Error, text?: string): number | undefined {
  const explicit = /position (\d+)/.exec(err.message);
  if (explicit?.[1] !== undefined) return Number(explicit[1]);

  if (!text) return undefined;
  const snippet = /"((?:[^"]|\\")*)" is not valid JSON/.exec(err.message)?.[1];
  if (!snippet) return undefined;
  const core = snippet.replace(/^\.\.\./, "").replace(/\.\.\.$/, "");
  if (core.length < 4) return undefined;
  const index = text.indexOf(core);
  return index >= 0 ? index + Math.floor(core.length / 2) : undefined;
}

function describeFailure(working: string): LooseJsonFailure {
  let message = "unknown parse error";
  let position: number | undefined;
  try {
    JSON.parse(working);
  } catch (err) {
    message = (err as Error).message;
    position = positionOf(err as Error, working);
  }

  // "Unterminated string" / "Unexpected end of JSON input" mean the text simply
  // stops. On a streamed reply that means it was read before it finished, which
  // is a different problem with a different fix than a malformed value.
  const truncated =
    /unterminated|unexpected end of (json )?input|end of data/i.test(message) ||
    (position !== undefined && position >= working.length - 2);

  return {
    ok: false,
    error: message,
    position,
    excerpt: excerptAround(working, position),
    truncated,
  };
}

/** The 240 characters either side of the failure — where the problem actually is. */
export function excerptAround(text: string, position: number | undefined, radius = 240): string {
  if (position === undefined || position < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, position)}❭HERE❬${text.slice(position, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Pulls the JSON object out of whatever the model wrapped it in.
 *
 * Braces are matched with the string state tracked, so a `{` inside a value —
 * or a chatty sentence containing one — cannot throw the scan off the way
 * indexOf/lastIndexOf could.
 */
export function extractJsonObject(text: string): string | null {
  const fenced = [...text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((block) => block.startsWith("{") || block.startsWith("["));
  const haystacks = fenced.length > 0 ? [...fenced, text] : [text];

  for (const haystack of haystacks) {
    const scanned = scanBalanced(haystack);
    if (scanned) return scanned;
  }
  // An unterminated object still needs reporting on, so hand back what there is
  // rather than pretending no JSON was present at all.
  const opener = text.search(/[{[]/);
  return opener >= 0 ? text.slice(opener) : null;
}

function scanBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

interface Repair {
  name: string;
  text: string;
}

function stripTrailingCommas(text: string): Repair {
  return { name: "removed trailing commas", text: text.replace(/,(\s*[}\]])/g, "$1") };
}

/** Typographic quotes appear when a model writes JSON as prose rather than in a code block. */
function straightenQuotes(text: string): Repair {
  return { name: "straightened typographic quotes", text: text.replace(/[“”]/g, '"') };
}

/** A raw newline or tab inside a string literal is invalid JSON; escape rather than discard it. */
function escapeControlCharacters(text: string): Repair {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      if (char === "\n") { out += "\\n"; continue; }
      if (char === "\r") { out += "\\r"; continue; }
      if (char === "\t") { out += "\\t"; continue; }
    } else if (char === '"') {
      inString = true;
    }
    out += char;
  }
  return { name: "escaped raw newlines inside strings", text: out };
}

/**
 * Escapes the quote that closed a string early.
 *
 * The parser stops at the first character it did not expect; the quote that
 * caused the trouble is the nearest one behind it. Returns null when there is
 * nothing behind the failure to escape, which means this is not that problem.
 */
function escapeQuoteBefore(text: string, position: number): string | null {
  for (let i = Math.min(position, text.length) - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '"') {
      if (text[i - 1] === "\\") return null;
      return `${text.slice(0, i)}\\${text.slice(i)}`;
    }
    // Only whitespace may sit between the premature quote and the failure; a
    // colon, comma or brace means the parser tripped over something else and
    // escaping a quote further back would corrupt the document.
    if (char !== undefined && !/\s/.test(char)) return null;
  }
  return null;
}
