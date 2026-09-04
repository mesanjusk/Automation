import { describe, expect, it } from "vitest";
import { buildFlowMission, renderFlowMission, unwrapPlan } from "./flowMission";

const PLAN = {
  title: "Janmashtami Divine Celebration",
  objective: "A premium Janmashtami social video.",
  aspectRatio: "9:16",
  language: "Hindi",
  continuityLock: "Same lead, same pastel yellow Anarkali, same living-room temple.",
  shots: [
    { index: 1, name: "Hook", durationSeconds: 6, visual: "temple at dawn", camera: "slow push in", voiceover: "Jai Shri Krishna" },
    { index: 2, name: "Jhula", durationSeconds: 8, prompt: "hands decorating the jhula", onScreenText: "Happy Janmashtami" },
  ],
  completionCriteria: ["Both clips generated", "Final MP4 exported"],
};

describe("buildFlowMission", () => {
  it("composes a self-contained Flow prompt for every shot", () => {
    const mission = buildFlowMission(PLAN)!;
    expect(mission.shots).toHaveLength(2);
    expect(mission.shots[0]!.prompt).toContain("temple at dawn");
    expect(mission.shots[0]!.prompt).toContain("Camera: slow push in");
    expect(mission.shots[0]!.prompt).toContain("Voice-over: Jai Shri Krishna");
    expect(mission.shots[0]!.prompt).toContain("Aspect ratio: 9:16. Target duration: 6 seconds.");
  });

  it("puts the continuity lock in every shot, because Flow sees one prompt at a time", () => {
    const mission = buildFlowMission(PLAN)!;
    for (const shot of mission.shots) {
      expect(shot.prompt).toContain("CONTINUITY LOCK — DO NOT CHANGE: Same lead");
    }
  });

  it("tells every shot after the first to continue from the previous clip", () => {
    const mission = buildFlowMission(PLAN)!;
    expect(mission.shots[0]!.prompt).not.toContain("Continue directly from");
    expect(mission.shots[1]!.prompt).toContain("Continue directly from the final frame");
  });

  it("renumbers shots so a planner's own numbering cannot skip or repeat one", () => {
    const mission = buildFlowMission({ ...PLAN, shots: PLAN.shots.map((s) => ({ ...s, index: 7 })) })!;
    expect(mission.shots.map((s) => s.index)).toEqual([1, 2]);
  });

  it("fills in sane defaults rather than emitting NaN or undefined into a prompt", () => {
    const mission = buildFlowMission({ shots: [{ visual: "a shot" }] })!;
    expect(mission.shots[0]!.durationSeconds).toBe(8);
    expect(mission.shots[0]!.prompt).toContain("Aspect ratio: 9:16. Target duration: 8 seconds.");
    expect(mission.title).toBe("Untitled video mission");
    expect(mission.shots[0]!.prompt).not.toContain("undefined");
    expect(mission.shots[0]!.prompt).not.toContain("NaN");
  });

  it("prefers an explicit prompt over the visual description", () => {
    const mission = buildFlowMission({ shots: [{ prompt: "use me", visual: "not me" }] })!;
    expect(mission.shots[0]!.prompt).toContain("use me");
    expect(mission.shots[0]!.prompt).not.toContain("not me");
  });

  it("rejects a plan with no usable shots rather than driving Flow with nothing", () => {
    expect(buildFlowMission({ title: "x", shots: [] })).toBeNull();
    expect(buildFlowMission({ title: "x" })).toBeNull();
    expect(buildFlowMission(null)).toBeNull();
    expect(buildFlowMission("not a plan")).toBeNull();
  });

  it("survives shots that are not objects", () => {
    const mission = buildFlowMission({ shots: ["just a string", { visual: "real" }] })!;
    expect(mission.shots).toHaveLength(2);
    expect(mission.shots[1]!.prompt).toContain("real");
  });
});

describe("unwrapPlan", () => {
  it("accepts the plan directly", () => {
    expect(unwrapPlan(PLAN)?.title).toBe(PLAN.title);
  });

  it("accepts the { result } wrapper an EXECUTE_JS node produces", () => {
    // Older runs stored the plan that way; a stored task must not stop working
    // because the workflow shape changed underneath it.
    expect(unwrapPlan({ result: PLAN })?.title).toBe(PLAN.title);
  });

  it("returns null for anything that is not an object", () => {
    expect(unwrapPlan("nope")).toBeNull();
    expect(unwrapPlan(undefined)).toBeNull();
  });
});

describe("renderFlowMission", () => {
  it("lists every shot in order with its composed prompt", () => {
    const rendered = renderFlowMission(buildFlowMission(PLAN)!);
    expect(rendered).toContain("SHOTS (2, generate every one in order)");
    expect(rendered).toContain("--- SHOT 1 (Hook), 6s ---");
    expect(rendered).toContain("--- SHOT 2 (Jhula), 8s ---");
    expect(rendered.indexOf("SHOT 1")).toBeLessThan(rendered.indexOf("SHOT 2"));
  });

  it("spells out the completion criteria the agent is held to", () => {
    const rendered = renderFlowMission(buildFlowMission(PLAN)!);
    expect(rendered).toContain("COMPLETION CRITERIA");
    expect(rendered).toContain("- Final MP4 exported");
  });

  it("stays within its budget so it cannot crowd out the page observation", () => {
    const huge = { ...PLAN, shots: Array.from({ length: 200 }, (_, i) => ({ visual: `shot ${i} `.repeat(50) })) };
    expect(renderFlowMission(buildFlowMission(huge)!).length).toBeLessThanOrEqual(11_000);
  });
});
