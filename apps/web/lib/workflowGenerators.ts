import type { WorkflowDefinition } from "@bos/shared";
import { buildVideoStudioWorkflow } from "./videoStudioWorkflow";

/**
 * Workflows that are emitted by code rather than drawn in the editor.
 *
 * A stored workflow version is a snapshot, which is exactly right for one a
 * person built and published: replaying it reproduces what they approved. It is
 * exactly wrong for one a generator produced, because that snapshot pins every
 * future retry to whatever the code happened to emit the day the run started —
 * so a bug fixed weeks ago keeps reappearing, with its original error message,
 * on every retry of an old task.
 */
export const WORKFLOW_GENERATORS: Record<string, () => WorkflowDefinition> = {
  "video-studio": buildVideoStudioWorkflow,
};

export const VIDEO_STUDIO_GENERATOR = "video-studio";

/**
 * The current definition for a generated workflow, or null when the workflow
 * was hand-built and its stored version should be replayed as-is.
 */
export function regenerateDefinition(generator: string | undefined | null): WorkflowDefinition | null {
  if (!generator) return null;
  const build = WORKFLOW_GENERATORS[generator];
  return build ? build() : null;
}
