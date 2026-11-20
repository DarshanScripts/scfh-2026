import type { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { isPlayback, type Playback, type ReadyWorkflow } from "./contracts";

type Scene = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>;
type Box = { x: number; y: number; width: number; height: number };

const FILLS = {
  action: "#dcefe9", decision: "#d5e8f6", handoff: "#c5e7dc",
  exception: "#fff0cf", gap: "#f6e4da",
};

export function workflowScene(workflow: ReadyWorkflow, count: number): Scene {
  const boxes = new Map<string, Box>();
  let row = 0;
  const visible = workflow.steps.slice(0, count);
  const nodes: Scene = visible.map((step, index) => {
    const side = step.kind === "exception" && row > 0;
    const box = { x: side ? 445 : 32, y: (side ? row - 1 : row++) * 220 + 24, width: 300, height: 152 };
    boxes.set(step.stepId, box);
    return {
      type: step.kind === "decision" ? "diamond" : "rectangle",
      id: step.stepId,
      ...box,
      seed: index + 10,
      fillStyle: "solid",
      backgroundColor: FILLS[step.kind],
      strokeColor: "#26475b",
      roughness: 0,
      label: { text: step.label, fontFamily: 2, fontSize: 17, textAlign: "center" },
    };
  });
  const edges: Scene = [];
  for (const step of visible) {
    const from = boxes.get(step.stepId)!;
    for (const edge of step.edges) {
      const to = boxes.get(edge.toStepId);
      if (!to) continue;
      const side = to.x > from.x;
      const x = side ? from.x + from.width : from.x + from.width / 2;
      const y = side ? from.y + from.height / 2 : from.y + from.height;
      const length = side ? to.x - x : to.y - y;
      edges.push({
        type: "arrow",
        id: step.stepId + "-to-" + edge.toStepId,
        x, y,
        points: [[0, 0], side ? [length, 0] : [0, length]],
        strokeColor: "#355a6b",
        roughness: 0,
        endArrowhead: "arrow",
        label: { text: edge.label, fontFamily: 2, fontSize: 14 },
      });
    }
  }
  return [...nodes, ...edges];
}

export function excalidrawInput(scene: Scene, partial = false) {
  // The pinned MCP view drops the last object of a partial array.
  const elements = partial
    ? [...scene, { type: "cameraUpdate", x: 0, y: 0, width: 4, height: 3 }]
    : scene;
  return { elements: JSON.stringify(elements) };
}

async function exportOptions(scene: Scene) {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  return {
    elements: convertToExcalidrawElements(scene, { regenerateIds: false }),
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
    files: null,
    exportPadding: 20,
  };
}

export async function renderDiagram(scene: Scene) {
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  return exportToSvg({ ...await exportOptions(scene), skipInliningFonts: true });
}

export async function exportDiagram(scene: Scene) {
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  return exportToBlob({ ...await exportOptions(scene), mimeType: "image/png" });
}

export class PlaybackRun {
  readonly runId = crypto.randomUUID();
  count = 0;
  state: "waiting" | "ready" | "playing" | "completed" | "cancelled" | "closed" | "failed" = "waiting";

  constructor(readonly workflow: ReadyWorkflow) {}

  event(type: Playback["type"], index = this.count): Playback {
    const base = { schemaVersion: 1 as const, runId: this.runId, turnId: this.workflow.turnId };
    if (type === "stepStarted" || type === "stepFinished") {
      return { ...base, type, stepId: this.workflow.steps[index].stepId, stepIndex: index };
    }
    return { ...base, type };
  }

  accept(input: unknown): input is Playback {
    if (!isPlayback(input) || input.runId !== this.runId || input.turnId !== this.workflow.turnId) return false;
    if (input.type === "closed" && this.state !== "closed") {
      this.state = "closed";
      return true;
    }
    if (["completed", "cancelled", "closed", "failed"].includes(this.state)) return false;
    if (input.type === "cancelled" || input.type === "failed") {
      this.state = input.type;
      return true;
    }
    if (input.type === "ready" && this.state === "waiting") {
      this.state = "ready";
      return true;
    }
    if (input.type === "completed" && this.state === "ready" && this.count === this.workflow.steps.length) {
      this.state = "completed";
      return true;
    }
    if (!("stepIndex" in input) || this.workflow.steps[input.stepIndex]?.stepId !== input.stepId) return false;
    if (input.type === "stepStarted" && this.state === "ready" && input.stepIndex === this.count) {
      this.count++;
      this.state = "playing";
      return true;
    }
    if (input.type === "stepFinished" && this.state === "playing" && input.stepIndex === this.count - 1) {
      this.state = "ready";
      return true;
    }
    return false;
  }
}
