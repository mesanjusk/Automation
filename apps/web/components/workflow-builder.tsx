"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { NODE_TYPES, type NodeType, type WorkflowDefinition, type WorkflowNode } from "@bos/shared";
import { Button, Card, Textarea, Input, Label, Select } from "@/components/ui/primitives";
import { saveWorkflowDraft, publishWorkflowVersion, generateWorkflowDraftFromDescription } from "@/lib/actions/workflows";
import { Sparkles, Save, Rocket, Plus } from "lucide-react";

const CATEGORIES: Record<string, NodeType[]> = {
  Browser: ["NAVIGATE", "CLICK", "TYPE", "CLEAR", "SELECT", "HOVER", "PRESS_KEY", "SCROLL", "UPLOAD_FILE", "DOWNLOAD_FILE"],
  Navigation: ["NEW_TAB", "SWITCH_TAB", "CLOSE_TAB", "GO_BACK", "GO_FORWARD", "WAIT", "WAIT_FOR_SELECTOR", "WAIT_FOR_NAVIGATION"],
  Data: ["EXTRACT_TEXT", "EXTRACT_ATTRIBUTE", "SCREENSHOT", "SET_VARIABLE", "GET_VARIABLE", "EXECUTE_JS"],
  Logic: ["CONDITION", "LOOP", "FOR_EACH", "END", "FAIL"],
  AI: ["AI_DECISION"],
  Human: ["HUMAN_APPROVAL"],
  Integration: ["WEBHOOK"],
};

function definitionToFlow(def: WorkflowDefinition): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = def.nodes.map((n, i) => ({
    id: n.id,
    position: n.position ?? { x: 260 * (i % 4), y: 160 * Math.floor(i / 4) },
    data: { node: n },
    type: "default",
    style: nodeStyle(n.type),
  }));
  const edges: Edge[] = [];
  for (const n of def.nodes) {
    if (n.next) edges.push({ id: `${n.id}->${n.next}`, source: n.id, target: n.next });
    if (n.type === "CONDITION") {
      if (n.config.trueNodeId) edges.push({ id: `${n.id}->yes->${n.config.trueNodeId}`, source: n.id, target: n.config.trueNodeId as string, label: "yes" });
      if (n.config.falseNodeId) edges.push({ id: `${n.id}->no->${n.config.falseNodeId}`, source: n.id, target: n.config.falseNodeId as string, label: "no" });
    }
  }
  return { nodes, edges };
}

function nodeStyle(type: NodeType): React.CSSProperties {
  const colors: Partial<Record<NodeType, string>> = {
    AI_DECISION: "#8b5cf6",
    HUMAN_APPROVAL: "#f59e0b",
    CONDITION: "#0ea5e9",
    END: "#16a34a",
    FAIL: "#dc2626",
    WEBHOOK: "#0891b2",
  };
  const color = colors[type] ?? "#334155";
  return { borderColor: color, borderWidth: 2, fontSize: 12, borderRadius: 8 };
}

export function WorkflowBuilder({
  workflowId,
  initialDefinition,
  currentVersion,
  publishedVersion,
}: {
  workflowId: string;
  initialDefinition: WorkflowDefinition;
  currentVersion: number;
  publishedVersion?: number;
}) {
  const initial = useMemo(() => definitionToFlow(initialDefinition), [initialDefinition]);
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [variables, setVariables] = useState(JSON.stringify(initialDefinition.variables ?? {}, null, 2));
  const [startNodeId, setStartNodeId] = useState(initialDefinition.startNodeId);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [nlDescription, setNlDescription] = useState("");
  const [nlLoading, setNlLoading] = useState(false);

  const selectedNode = nodes.find((n) => n.id === selectedId)?.data?.node as WorkflowNode | undefined;

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== connection.source) return n;
          const node = n.data.node as WorkflowNode;
          return { ...n, data: { node: { ...node, next: connection.target } } };
        })
      );
    },
    []
  );

  function addNode(type: NodeType) {
    const id = `${type.toLowerCase()}_${Date.now().toString(36)}`;
    const newNode: WorkflowNode = {
      id,
      type,
      name: type.replaceAll("_", " "),
      config: {},
      timeout: 30000,
      retry: { maxRetries: type === "FAIL" || type === "END" ? 0 : 1, delayMs: 1000, exponentialBackoff: true, maxDelayMs: 30000 },
      continueOnError: false,
    };
    setNodes((nds) => [...nds, { id, position: { x: 100 + nds.length * 20, y: 100 + nds.length * 20 }, data: { node: newNode }, style: nodeStyle(type) }]);
  }

  function updateSelectedNode(patch: Partial<WorkflowNode>) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const node = { ...(n.data.node as WorkflowNode), ...patch };
        return { ...n, data: { node } };
      })
    );
  }

  function buildDefinition(): WorkflowDefinition {
    return {
      startNodeId,
      nodes: nodes.map((n) => ({ ...(n.data.node as WorkflowNode), position: n.position })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === "string" ? e.label : undefined })),
      variables: safeParseJson(variables),
    };
  }

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      try {
        const version = await saveWorkflowDraft(workflowId, buildDefinition());
        setMessage(`Saved as version ${version}.`);
      } catch (err) {
        setMessage((err as Error).message);
      }
    });
  }

  function handlePublish() {
    setMessage(null);
    startTransition(async () => {
      try {
        const version = await saveWorkflowDraft(workflowId, buildDefinition(), "Published from builder");
        await publishWorkflowVersion(workflowId, version);
        setMessage(`Published version ${version}.`);
      } catch (err) {
        setMessage((err as Error).message);
      }
    });
  }

  async function handleGenerate() {
    setNlLoading(true);
    setMessage(null);
    try {
      const draft = await generateWorkflowDraftFromDescription(nlDescription);
      const flow = definitionToFlow(draft);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setStartNodeId(draft.startNodeId);
      setVariables(JSON.stringify(draft.variables ?? {}, null, 2));
      setMessage("AI draft loaded onto the canvas — review every node, then Save. Nothing has been run or persisted yet.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setNlLoading(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Draft version {currentVersion}</span>
          {publishedVersion && <span className="text-success">· Published v{publishedVersion} is live</span>}
        </div>
        <div className="flex items-center gap-2">
          {message && <span className="max-w-[420px] truncate text-xs text-muted-foreground">{message}</span>}
          <Button variant="outline" size="sm" disabled={pending} onClick={handleSave}>
            <Save className="h-3.5 w-3.5" /> Save draft
          </Button>
          <Button size="sm" disabled={pending} onClick={handlePublish}>
            <Rocket className="h-3.5 w-3.5" /> Publish
          </Button>
        </div>
      </div>

      <Card className="flex items-center gap-2 p-3">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <Textarea
          rows={1}
          className="flex-1"
          placeholder="Describe what the browser should do (e.g. 'Log in, search each product, extract price and stock')..."
          value={nlDescription}
          onChange={(e) => setNlDescription(e.target.value)}
        />
        <Button size="sm" disabled={nlLoading || nlDescription.length < 10} onClick={handleGenerate}>
          {nlLoading ? "Generating..." : "Generate draft"}
        </Button>
      </Card>

      <div className="flex flex-1 gap-3 overflow-hidden">
        <Card className="w-48 shrink-0 overflow-y-auto p-2">
          {Object.entries(CATEGORIES).map(([category, types]) => (
            <div key={category} className="mb-3">
              <p className="mb-1 px-1 text-xs font-semibold text-muted-foreground">{category}</p>
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => addNode(t)}
                  className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <Plus className="h-3 w-3" /> {t.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          ))}
        </Card>

        <div className="flex-1 overflow-hidden rounded-lg border border-border">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <Card className="w-80 shrink-0 overflow-y-auto p-3">
          {!selectedNode ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-2 text-sm font-medium">Workflow settings</p>
                <Label htmlFor="startNodeId">Start node ID</Label>
                <Input id="startNodeId" value={startNodeId} onChange={(e) => setStartNodeId(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="variables">Initial variables (JSON)</Label>
                <Textarea id="variables" rows={8} value={variables} onChange={(e) => setVariables(e.target.value)} className="mt-1 font-mono text-xs" />
              </div>
              <p className="text-xs text-muted-foreground">Select a node on the canvas to edit it.</p>
            </div>
          ) : (
            <NodeEditor node={selectedNode} onChange={updateSelectedNode} />
          )}
        </Card>
      </div>
    </div>
  );
}

function NodeEditor({ node, onChange }: { node: WorkflowNode; onChange: (patch: Partial<WorkflowNode>) => void }) {
  const [configText, setConfigText] = useState(JSON.stringify(node.config, null, 2));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{node.type}</p>
      <div>
        <Label htmlFor="node-id">ID</Label>
        <Input id="node-id" value={node.id} disabled className="mt-1 font-mono text-xs" />
      </div>
      <div>
        <Label htmlFor="node-name">Name</Label>
        <Input id="node-name" value={node.name} onChange={(e) => onChange({ name: e.target.value })} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="node-next">Next node ID</Label>
        <Input id="node-next" value={node.next ?? ""} onChange={(e) => onChange({ next: e.target.value || null })} className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="node-timeout">Timeout (ms)</Label>
          <Input id="node-timeout" type="number" value={node.timeout} onChange={(e) => onChange({ timeout: Number(e.target.value) })} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="node-retries">Max retries</Label>
          <Input
            id="node-retries"
            type="number"
            value={node.retry.maxRetries}
            onChange={(e) => onChange({ retry: { ...node.retry, maxRetries: Number(e.target.value) } })}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="node-config">Config (JSON)</Label>
        <Textarea
          id="node-config"
          rows={12}
          value={configText}
          onChange={(e) => {
            setConfigText(e.target.value);
            const parsed = safeParseJson(e.target.value);
            onChange({ config: parsed });
          }}
          className="mt-1 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Common fields: target ({`{css,text,role,ariaLabel,testId}`}), value, url, variableName, condition, trueNodeId/falseNodeId,
          bodyNodeId/bodyEndNodeId/loopCount, prompt (AI_DECISION), approvalMessage (HUMAN_APPROVAL), webhookUrl.
        </p>
      </div>
    </div>
  );
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}
