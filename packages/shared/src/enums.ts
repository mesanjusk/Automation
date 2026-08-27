// Central enums shared across web, worker, and every package. Keep this file
// the single source of truth — do not redefine these strings elsewhere.

export const NODE_TYPES = ["NAVIGATE","CLICK","TYPE","CLEAR","SELECT","HOVER","PRESS_KEY","WAIT","WAIT_FOR_SELECTOR","WAIT_FOR_NAVIGATION","EXTRACT_TEXT","EXTRACT_ATTRIBUTE","SCREENSHOT","UPLOAD_FILE","DOWNLOAD_FILE","NEW_TAB","SWITCH_TAB","CLOSE_TAB","GO_BACK","GO_FORWARD","SCROLL","EXECUTE_JS","PROBE_PAGE","WAIT_FOR_STATE","FLOW_NAVIGATE","CONDITION","LOOP","FOR_EACH","SET_VARIABLE","GET_VARIABLE","AI_DECISION","HUMAN_APPROVAL","WEBHOOK","END","FAIL"] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const TASK_STATUSES = ["QUEUED","STARTING","RUNNING","WAITING_FOR_HUMAN","RETRYING","COMPLETED","FAILED","CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const EXECUTION_STEP_STATUSES = ["PENDING","RUNNING","SUCCESS","FAILED","SKIPPED","RETRIED"] as const;
export type ExecutionStepStatus = (typeof EXECUTION_STEP_STATUSES)[number];
export const FAILURE_CATEGORIES = ["TRANSIENT","PERMANENT","AUTHENTICATION","HUMAN_INTERVENTION_REQUIRED","WEBSITE_CHANGED"] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];
export const HUMAN_INTERVENTION_REASONS = ["CAPTCHA","MFA","APPROVAL","UNKNOWN_STATE","MANUAL_LOGIN_REQUIRED"] as const;
export type HumanInterventionReason = (typeof HUMAN_INTERVENTION_REASONS)[number];
export const AGENT_TOOLS = ["browser_navigate","browser_click","browser_type","browser_clear","browser_select","browser_press","browser_hover","browser_scroll","browser_wait","browser_read","browser_extract","browser_screenshot","browser_upload","browser_download","browser_new_tab","browser_switch_tab","browser_close_tab","browser_back","browser_forward","task_complete","task_fail"] as const;
export type AgentTool = (typeof AGENT_TOOLS)[number];
// Screens the Google Flow driver knows how to tell apart. Classified from the
// live DOM/accessibility data at run time (see packages/browser/flowState.ts)
// — never assumed from the URL alone.
export const FLOW_STATES = ["LOADING","LOGIN_REQUIRED","LANDING","WORKSPACE","GENERATION_UI","GENERATING","CLIP_READY","ERROR","UNKNOWN"] as const;
export type FlowState = (typeof FLOW_STATES)[number];

export const SELECTOR_STRATEGIES = ["css","role","text","aria-label","nearby-text","xpath","ai-visual"] as const;
export type SelectorStrategy = (typeof SELECTOR_STRATEGIES)[number];
export const SCHEDULE_FREQUENCIES = ["ONCE","HOURLY","DAILY","WEEKLY","CRON"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
export const FILE_PROVIDERS = ["local","cloudinary"] as const;
export type FileProvider = (typeof FILE_PROVIDERS)[number];
export const QUEUE_NAMES = {
  automationTasks: "automation-tasks",
  automationTasksLocal: "automation-tasks-local",
  browserSessions: "browser-sessions",
  screenshots: "screenshots",
  webhooks: "webhooks",
  cleanup: "cleanup",
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
