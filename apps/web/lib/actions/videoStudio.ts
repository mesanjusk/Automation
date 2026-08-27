"use server";

import { redirect } from "next/navigation";
import { dbConnect } from "@/lib/db";
import { Automation, Task, Workflow, WorkflowVersion } from "@bos/database";
import { enqueueAutomationTask } from "@bos/queue";
import type { WorkflowDefinition } from "@bos/shared";

const RETRY = { maxRetries: 2, delayMs: 2000, exponentialBackoff: true, maxDelayMs: 15000 };

function buildWorkflow(): WorkflowDefinition {
  const masterPrompt = `You are the production brain for an automated social-video pipeline. The user gives ONLY an idea. Convert it into one complete Google Flow Agent production brief. Do not ask questions and do not explain your reasoning. Infer the best creative treatment from the idea.

USER IDEA:\n{{idea}}\n

OUTPUT ONLY THE FINAL FLOW AGENT BRIEF. It must instruct Google Flow to create the complete video as a sequence of short clips and maintain continuity between clips. Requirements: vertical 9:16 by default unless the idea clearly needs another ratio; use 6-8 second shots, never one long generation; strong 2-3 second opening hook; consistent character/product appearance, clothes, facial features, body proportions, colors, props, location style, lighting and color grade across every shot; natural camera movement; realistic hands and faces; clean transitions; voiceover in the language implied by the idea; on-screen text/captions timed to the spoken words when useful; include exact dialogue/voiceover per shot; avoid changing products, logos, packaging or characters between shots; reuse the same references/ingredients across shots; if the concept needs a CTA, put it in the final shot. Tell Flow to generate scene-by-scene and continue each next shot from the previous ending frame whenever possible. Keep prompts concise enough for Flow.

Structure the brief with: Project goal, global continuity lock, then Shot 1, Shot 2, etc. For every shot include duration, visual/action, camera, voiceover/dialogue, on-screen text, and continuity instruction. End with final export intent. Do not mention ChatGPT.`;

  const waitForChatGpt = `async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let last = "";
    let stable = 0;
    for (let i = 0; i < 120; i++) {
      const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const el = nodes[nodes.length - 1];
      const text = (el?.innerText || el?.textContent || "").trim();
      if (text && text === last && text.length > 200) stable++; else stable = 0;
      last = text || last;
      if (stable >= 3) return last;
      await sleep(1500);
    }
    if (!last) throw new Error('ChatGPT response was not detected. Make sure this browser profile is logged in to ChatGPT.');
    return last;
  }`;

  return {
    startNodeId: "open_chatgpt",
    variables: {},
    edges: [],
    nodes: [
      { id: "open_chatgpt", type: "NAVIGATE", name: "Open ChatGPT", config: { url: "https://chatgpt.com/" }, next: "wait_chat_box", timeout: 45000, retry: RETRY, continueOnError: false },
      { id: "wait_chat_box", type: "WAIT_FOR_SELECTOR", name: "Wait for ChatGPT input", config: { target: { css: "textarea" } }, next: "type_master_prompt", timeout: 45000, retry: RETRY, continueOnError: false },
      { id: "type_master_prompt", type: "TYPE", name: "Send idea to production brain", config: { target: { css: "textarea", role: "textbox" }, value: masterPrompt }, next: "submit_chatgpt", timeout: 30000, retry: RETRY, continueOnError: false },
      { id: "submit_chatgpt", type: "PRESS_KEY", name: "Submit idea", config: { target: { css: "textarea" }, key: "Enter" }, next: "collect_flow_brief", timeout: 30000, retry: RETRY, continueOnError: false },
      { id: "collect_flow_brief", type: "EXECUTE_JS", name: "Collect Flow production brief", config: { script: waitForChatGpt, variableName: "flowBrief" }, next: "open_flow", timeout: 210000, retry: { ...RETRY, maxRetries: 0 }, continueOnError: false },
      { id: "open_flow", type: "NEW_TAB", name: "Open Google Flow", config: { url: "https://labs.google/fx/tools/flow" }, next: "wait_flow", timeout: 45000, retry: RETRY, continueOnError: false },
      { id: "wait_flow", type: "WAIT", name: "Let Flow load", config: { ms: 8000 }, next: "enable_agent", timeout: 15000, retry: RETRY, continueOnError: false },
      { id: "enable_agent", type: "CLICK", name: "Enable Flow Agent", config: { target: { role: "button", text: "Agent", ariaLabel: "Agent" } }, next: "wait_flow_prompt", timeout: 30000, retry: RETRY, continueOnError: true },
      { id: "wait_flow_prompt", type: "WAIT_FOR_SELECTOR", name: "Wait for Flow prompt", config: { target: { role: "textbox", css: "textarea, [contenteditable='true']" } }, next: "type_flow_brief", timeout: 45000, retry: RETRY, continueOnError: false },
      { id: "type_flow_brief", type: "TYPE", name: "Give Flow the full production brief", config: { target: { role: "textbox", css: "textarea, [contenteditable='true']" }, value: "{{flowBrief.result}}" }, next: "generate_flow", timeout: 30000, retry: RETRY, continueOnError: false },
      { id: "generate_flow", type: "CLICK", name: "Start Flow generation", config: { target: { role: "button", text: "Generate", ariaLabel: "Generate" } }, next: "wait_generation", timeout: 30000, retry: RETRY, continueOnError: false },
      { id: "wait_generation", type: "WAIT", name: "Allow Flow to start generation", config: { ms: 120000 }, next: "capture_result", timeout: 130000, retry: { ...RETRY, maxRetries: 0 }, continueOnError: false },
      { id: "capture_result", type: "SCREENSHOT", name: "Capture Flow result", config: {}, next: "done", timeout: 30000, retry: RETRY, continueOnError: true },
      { id: "done", type: "END", name: "Video generation started", config: {}, timeout: 0, retry: { maxRetries: 0, delayMs: 0, exponentialBackoff: false, maxDelayMs: 0 }, continueOnError: false }
    ]
  };
}

export async function runIdeaToFlowVideo(formData: FormData) {
  await dbConnect();
  const idea = String(formData.get("idea") ?? "").trim();
  const browserProfileId = String(formData.get("browserProfileId") ?? "").trim();
  if (idea.length < 5) throw new Error("Please enter a short video idea.");
  if (!browserProfileId) throw new Error("Choose a browser profile logged in to both ChatGPT and Google Flow.");

  const workflow = await Workflow.create({
    name: `Video Studio - ${idea.slice(0, 48)}`,
    description: "API-free ChatGPT web -> Google Flow Agent video production",
    status: "published",
    currentVersion: 1,
  });
  const version = await WorkflowVersion.create({ workflowId: workflow._id, version: 1, definition: buildWorkflow(), publishedAt: new Date(), notes: "Generated by Video Studio" });
  workflow.publishedVersionId = version._id;
  await workflow.save();

  const automation = await Automation.create({
    name: `Flow Video - ${idea.slice(0, 48)}`,
    description: "One-idea video automation using logged-in ChatGPT and Google Flow sessions; no paid AI API required.",
    slug: `flow-video-${Date.now().toString(36)}`,
    workflowId: workflow._id,
    browserProfileId,
    status: "active",
    enabled: true,
  });

  const task = await Task.create({
    automationId: automation._id,
    workflowId: workflow._id,
    workflowVersionId: version._id,
    status: "QUEUED",
    input: { idea },
    browserProfileId,
    source: "video-studio",
  });
  await enqueueAutomationTask(String(task._id));
  redirect(`/tasks/${task._id}`);
}
