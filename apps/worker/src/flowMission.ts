/**
 * Turns the planner's raw JSON into the mission the Flow agent works from.
 *
 * This composition used to run inside the page script that scraped the reply,
 * which meant it could only ever run once, could not be tested, and took the
 * whole run down with it if the reply had a stray character. It is ordinary
 * Node code now: the parse happens in PARSE_JSON, and this shapes whatever
 * came back — defensively, because a model's "strict JSON" is a best effort
 * and a missing field should cost one clip's polish, not the run.
 */

export interface FlowShot {
  index: number;
  name?: string;
  durationSeconds: number;
  /** Self-contained text to paste straight into Flow's composer. */
  prompt: string;
}

export interface FlowMission {
  title: string;
  objective?: string;
  aspectRatio: string;
  language?: string;
  continuityLock?: string;
  shots: FlowShot[];
  editing?: Record<string, unknown>;
  audio?: Record<string, unknown>;
  export?: Record<string, unknown>;
  completionCriteria: string[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Accepts the plan itself, or the `{ result: … }` wrapper an EXECUTE_JS node produces. */
export function unwrapPlan(raw: unknown): Record<string, unknown> | null {
  const direct = record(raw);
  if (!direct) return null;
  const inner = record(direct.result);
  if (inner && (Array.isArray(inner.shots) || inner.title)) return inner;
  return direct;
}

export function buildFlowMission(raw: unknown): FlowMission | null {
  const plan = unwrapPlan(raw);
  if (!plan) return null;

  const rawShots = Array.isArray(plan.shots) ? plan.shots : [];
  const aspectRatio = str(plan.aspectRatio) || "9:16";
  const continuityLock = str(plan.continuityLock);

  const shots: FlowShot[] = rawShots.map((entry, i) => {
    const shot = record(entry) ?? {};
    const durationSeconds = Number(shot.durationSeconds) > 0 ? Number(shot.durationSeconds) : 8;
    const body = str(shot.prompt) || str(shot.visual);
    return {
      index: i + 1,
      name: str(shot.name) || undefined,
      durationSeconds,
      prompt: [
        i > 0 ? "Continue directly from the final frame/visual identity of the previous generated clip." : "",
        continuityLock ? `CONTINUITY LOCK — DO NOT CHANGE: ${continuityLock}` : "",
        body,
        str(shot.camera) ? `Camera: ${str(shot.camera)}` : "",
        str(shot.voiceover) ? `Voice-over: ${str(shot.voiceover)}` : "",
        str(shot.dialogue) ? `Dialogue: ${str(shot.dialogue)}` : "",
        str(shot.onScreenText) ? `On-screen text: ${str(shot.onScreenText)}` : "",
        `Aspect ratio: ${aspectRatio}. Target duration: ${durationSeconds} seconds.`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });

  if (shots.length === 0) return null;

  return {
    title: str(plan.title) || "Untitled video mission",
    objective: str(plan.objective) || undefined,
    aspectRatio,
    language: str(plan.language) || undefined,
    continuityLock: continuityLock || undefined,
    shots,
    editing: record(plan.editing),
    audio: record(plan.audio),
    export: record(plan.export),
    completionCriteria: Array.isArray(plan.completionCriteria)
      ? plan.completionCriteria.map(str).filter(Boolean)
      : [],
  };
}

/** Renders the mission for the browser brain, bounded so it cannot crowd out the observation. */
export function renderFlowMission(mission: FlowMission, maxLength = 11_000): string {
  const lines = [
    `TITLE: ${mission.title}`,
    mission.objective ? `OBJECTIVE: ${mission.objective}` : "",
    `ASPECT RATIO: ${mission.aspectRatio}`,
    mission.language ? `LANGUAGE: ${mission.language}` : "",
    mission.continuityLock ? `CONTINUITY LOCK: ${mission.continuityLock}` : "",
    "",
    `SHOTS (${mission.shots.length}, generate every one in order):`,
    ...mission.shots.map(
      (shot) => `--- SHOT ${shot.index}${shot.name ? ` (${shot.name})` : ""}, ${shot.durationSeconds}s ---\n${shot.prompt}`
    ),
  ];
  if (mission.editing) lines.push("", `EDITING: ${JSON.stringify(mission.editing)}`);
  if (mission.audio) lines.push(`AUDIO: ${JSON.stringify(mission.audio)}`);
  if (mission.export) lines.push(`EXPORT: ${JSON.stringify(mission.export)}`);
  if (mission.completionCriteria.length > 0) {
    lines.push("", "COMPLETION CRITERIA (all must be met before you may report done):");
    lines.push(...mission.completionCriteria.map((criterion) => `- ${criterion}`));
  }
  return lines.filter((line) => line !== "").join("\n").slice(0, maxLength);
}
