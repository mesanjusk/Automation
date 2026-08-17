// Seeds a self-contained "Demo Website Data Extraction" automation that runs
// against apps/test-site (never a real third-party site). Run with:
//   npm run seed:demo
// after `npm run dev:test-site` and with MONGODB_URI reachable.
import "dotenv/config";
import { connectToDatabase, disconnectDatabase, Workflow, WorkflowVersion, Automation } from "@bos/database";
import type { WorkflowDefinition } from "@bos/shared";

const TEST_SITE_URL = process.env.TEST_SITE_URL || "http://localhost:4100";

const definition: WorkflowDefinition = {
  startNodeId: "open_login",
  variables: { query: "P00" },
  edges: [],
  nodes: [
    {
      id: "open_login",
      type: "NAVIGATE",
      name: "Open login page",
      config: { url: `${TEST_SITE_URL}/login` },
      next: "type_username",
      timeout: 30000,
      retry: { maxRetries: 2, delayMs: 1000, exponentialBackoff: true, maxDelayMs: 10000 },
      continueOnError: false,
    },
    {
      id: "type_username",
      type: "TYPE",
      name: "Enter username",
      config: { target: { testId: "username-input" }, value: "demo" },
      next: "type_password",
      timeout: 10000,
      retry: { maxRetries: 1, delayMs: 500, exponentialBackoff: true, maxDelayMs: 5000 },
      continueOnError: false,
    },
    {
      id: "type_password",
      type: "TYPE",
      name: "Enter password",
      config: { target: { testId: "password-input" }, value: "{{secret:test_site_password}}" },
      next: "click_login",
      timeout: 10000,
      retry: { maxRetries: 1, delayMs: 500, exponentialBackoff: true, maxDelayMs: 5000 },
      continueOnError: false,
    },
    {
      id: "click_login",
      type: "CLICK",
      name: "Submit login",
      config: { target: { testId: "login-button" } },
      next: "type_search",
      timeout: 10000,
      retry: { maxRetries: 1, delayMs: 500, exponentialBackoff: true, maxDelayMs: 5000 },
      continueOnError: false,
    },
    {
      id: "type_search",
      type: "TYPE",
      name: "Enter search query",
      config: { target: { testId: "search-input" }, value: "{{query}}" },
      next: "click_search",
      timeout: 10000,
      retry: { maxRetries: 1, delayMs: 500, exponentialBackoff: true, maxDelayMs: 5000 },
      continueOnError: false,
    },
    {
      id: "click_search",
      type: "CLICK",
      name: "Run search",
      config: { target: { testId: "search-button" } },
      next: "wait_results",
      timeout: 10000,
      retry: { maxRetries: 1, delayMs: 500, exponentialBackoff: true, maxDelayMs: 5000 },
      continueOnError: false,
    },
    {
      id: "wait_results",
      type: "WAIT_FOR_SELECTOR",
      name: "Wait for results table",
      config: { target: { testId: "results-table" } },
      next: "extract_row",
      timeout: 15000,
      retry: { maxRetries: 2, delayMs: 1000, exponentialBackoff: true, maxDelayMs: 10000 },
      continueOnError: false,
    },
    {
      id: "extract_row",
      type: "EXTRACT_TEXT",
      name: "Extract first product row",
      config: { target: { testId: "row-P001" }, variableName: "firstRowText" },
      next: "screenshot_results",
      timeout: 10000,
      retry: { maxRetries: 1, delayMs: 500, exponentialBackoff: true, maxDelayMs: 5000 },
      continueOnError: true,
    },
    {
      id: "screenshot_results",
      type: "SCREENSHOT",
      name: "Screenshot results",
      config: {},
      next: "check_stock",
      timeout: 10000,
      retry: { maxRetries: 0, delayMs: 0, exponentialBackoff: false, maxDelayMs: 0 },
      continueOnError: true,
    },
    {
      id: "check_stock",
      type: "CONDITION",
      name: "Is stock available?",
      config: {
        condition: { left: "firstRowText", operator: "contains", right: "42" },
        trueNodeId: "download_invoice",
        falseNodeId: "skip_download",
      },
      timeout: 0,
      retry: { maxRetries: 0, delayMs: 0, exponentialBackoff: false, maxDelayMs: 0 },
      continueOnError: false,
    },
    {
      id: "download_invoice",
      type: "DOWNLOAD_FILE",
      name: "Download invoice",
      config: { target: { testId: "download-P001" } },
      next: "end",
      timeout: 15000,
      retry: { maxRetries: 1, delayMs: 1000, exponentialBackoff: true, maxDelayMs: 5000 },
      continueOnError: true,
    },
    {
      id: "skip_download",
      type: "SET_VARIABLE",
      name: "Mark download skipped",
      config: { variableName: "downloadSkipped", variableValue: true },
      next: "end",
      timeout: 0,
      retry: { maxRetries: 0, delayMs: 0, exponentialBackoff: false, maxDelayMs: 0 },
      continueOnError: false,
    },
    {
      id: "end",
      type: "END",
      name: "Done",
      config: {},
      timeout: 0,
      retry: { maxRetries: 0, delayMs: 0, exponentialBackoff: false, maxDelayMs: 0 },
      continueOnError: false,
    },
  ],
};

async function main() {
  await connectToDatabase();

  let workflow = await Workflow.findOne({ name: "Demo Website Data Extraction" });
  if (!workflow) {
    workflow = await Workflow.create({ name: "Demo Website Data Extraction", description: "Logs into the local test site, searches, extracts data, and conditionally downloads an invoice.", status: "draft", currentVersion: 1 });
  }
  const version = await WorkflowVersion.create({ workflowId: workflow._id, version: workflow.currentVersion + 1, definition, publishedAt: new Date() });
  workflow.currentVersion = version.version;
  workflow.status = "published";
  workflow.publishedVersionId = version._id;
  await workflow.save();

  let automation = await Automation.findOne({ slug: "demo-website-data-extraction" });
  if (!automation) {
    automation = await Automation.create({
      name: "Demo Website Data Extraction",
      description: "Reference automation that exercises the full engine against the bundled local test site (apps/test-site).",
      slug: "demo-website-data-extraction",
      workflowId: workflow._id,
      status: "active",
      enabled: true,
    });
  } else {
    automation.workflowId = workflow._id;
    await automation.save();
  }

  console.log(`Seeded workflow "${workflow.name}" (v${workflow.currentVersion}, published) and automation "${automation.name}" (${automation.slug}).`);
  console.log(`Run it with: curl -X POST $API_BASE_URL/api/v1/automations/run -H "X-API-Key: $BOOTSTRAP_API_KEY" -H "Content-Type: application/json" -d '{"automation":"demo-website-data-extraction","input":{}}'`);
  console.log(`Note: create a credential named "test_site_password" with value "demo123" in the dashboard first (Credentials page), or the login step will fail.`);

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
