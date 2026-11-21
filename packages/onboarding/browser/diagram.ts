import { isPlayback, type Playback, type ReadyWorkflow } from "./contracts";
import type { Scene } from "./canvas-export";
import { layoutScene } from "./scene-layout.mjs";

export { exportDiagram, renderDiagram } from "./canvas-export";
export function workflowScene(workflow: ReadyWorkflow, count: number): Scene {
  const nodes = workflow.steps.map(step => ({ id: step.stepId, label: step.label, kind: step.kind }));
  const links = workflow.steps.flatMap(step => step.edges.map(edge => ({
    id: `${step.stepId}-to-${edge.toStepId}`, from: step.stepId, to: edge.toStepId, label: edge.label,
  })));
  const { cards, arrows } = layoutScene(nodes, links);
  const visible = new Set(nodes.slice(0, count).map(node => node.id));
  return [...cards.slice(0, count), ...arrows.filter((_, i) => visible.has(links[i].from) && visible.has(links[i].to))];
}

export function excalidrawInput(scene: Scene, partial = false) {
  // The pinned MCP view drops the last object of a partial array.
  const elements = partial
    ? [...scene, { type: "cameraUpdate", x: 0, y: 0, width: 4, height: 3 }]
    : scene;
  return { elements: JSON.stringify(elements) };
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
