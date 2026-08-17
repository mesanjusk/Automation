import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  agentActionSchema,
  workflowDefinitionSchema,
  visionTargetResultSchema,
  type AgentAction,
  type AgentContext,
  type VisionTargetResult,
  type WorkflowDefinition,
} from "@bos/shared";
import type { LLMProvider } from "./provider";
import { buildAgentPrompt, buildVisionLocatePrompt, buildWorkflowGenerationPrompt } from "./promptBuilder";

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private client: GoogleGenerativeAI;
  private modelName: string;
  private visionModelName: string;

  constructor(apiKey = process.env.GEMINI_API_KEY, modelName = process.env.GEMINI_MODEL, visionModelName = process.env.GEMINI_VISION_MODEL) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName || "gemini-2.0-flash";
    this.visionModelName = visionModelName || this.modelName;
  }

  async decideNextAction(
    context: AgentContext
  ): Promise<{ action: AgentAction; rawResponse: string; tokensUsed?: number }> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      generationConfig: { responseMimeType: "application/json" },
    });
    const prompt = buildAgentPrompt(context);
    const result = await model.generateContent(prompt);
    const rawResponse = result.response.text();
    const parsed = agentActionSchema.safeParse(JSON.parse(extractJson(rawResponse)));
    if (!parsed.success) {
      throw new Error(`Gemini returned an invalid action: ${parsed.error.message}`);
    }
    return {
      action: parsed.data,
      rawResponse,
      tokensUsed: result.response.usageMetadata?.totalTokenCount,
    };
  }

  async locateElementInScreenshot(screenshotBase64: string, instruction: string): Promise<VisionTargetResult> {
    const model = this.client.getGenerativeModel({
      model: this.visionModelName,
      generationConfig: { responseMimeType: "application/json" },
    });
    const result = await model.generateContent([
      buildVisionLocatePrompt(instruction),
      { inlineData: { mimeType: "image/png", data: screenshotBase64 } },
    ]);
    const parsed = visionTargetResultSchema.safeParse(JSON.parse(extractJson(result.response.text())));
    if (!parsed.success) return { found: false };
    return parsed.data;
  }

  async generateWorkflowDraft(
    description: string
  ): Promise<{ definition: WorkflowDefinition; rawResponse: string }> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      generationConfig: { responseMimeType: "application/json" },
    });
    const result = await model.generateContent(buildWorkflowGenerationPrompt(description));
    const rawResponse = result.response.text();
    const parsed = workflowDefinitionSchema.safeParse(JSON.parse(extractJson(rawResponse)));
    if (!parsed.success) {
      throw new Error(`Gemini returned an invalid workflow draft: ${parsed.error.message}`);
    }
    return { definition: parsed.data, rawResponse };
  }
}
