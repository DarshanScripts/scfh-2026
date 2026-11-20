import { beforeAll, expect, test } from "bun:test";
import { isWalkthrough, type ReadyWorkflow } from "../browser/contracts";
import { excalidrawInput, PlaybackRun, workflowScene } from "../browser/diagram";

let workflow: ReadyWorkflow;

beforeAll(() => {
  const result = Bun.spawnSync([
    "uv", "run", "--locked", "--no-env-file", "python", "-c",
    "from onboarding import FixtureKnowledge; print(FixtureKnowledge().get_onboarding_walkthrough('Explain maintenance intake').model_dump_json())",
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  const value: unknown = JSON.parse(result.stdout.toString());
  if (!isWalkthrough(value) || value.outcome !== "ready") throw new Error("Invalid workflow response");
  workflow = value;
});

test("reveals nodes in narration order and adds edges after both endpoints", () => {
  for (const [index, step] of workflow.steps.entries()) {
    const scene = workflowScene(workflow, index + 1);
    const nodes = scene.filter(element => element.type !== "arrow");
    expect(nodes.map(element => element.id)).toEqual(workflow.steps.slice(0, index + 1).map(item => item.stepId));
    expect(nodes.at(-1)?.id).toBe(step.stepId);
    for (const element of scene.filter(item => item.type === "arrow")) {
      const source = workflow.steps.find(item => item.edges.some(edge => item.stepId + "-to-" + edge.toStepId === element.id));
      expect(source && nodes.some(node => node.id === source.stepId)).toBe(true);
      expect(nodes.some(node => element.id?.endsWith("-to-" + node.id))).toBe(true);
    }
  }
  const fullScene = workflowScene(workflow, workflow.steps.length);
  expect(fullScene).toHaveLength(workflow.steps.length + workflow.steps.flatMap(step => step.edges).length);
  expect(JSON.parse(excalidrawInput(fullScene).elements)).toEqual(fullScene);
  expect(JSON.parse(excalidrawInput(fullScene, true).elements).slice(0, -1)).toEqual(fullScene);
});

test("rejects early, duplicate, cancelled, and stale playback events", () => {
  const first = new PlaybackRun(workflow);
  expect(first.accept(first.event("stepStarted", 0))).toBe(false);
  expect(first.accept(first.event("ready"))).toBe(true);
  expect(first.accept(first.event("stepStarted", 1))).toBe(false);
  expect(first.accept(first.event("stepStarted", 0))).toBe(true);
  expect(first.accept(first.event("stepStarted", 0))).toBe(false);
  expect(first.accept(first.event("cancelled"))).toBe(true);
  expect(first.accept(first.event("stepFinished", 0))).toBe(false);

  const next = new PlaybackRun(workflow);
  expect(next.accept(first.event("ready"))).toBe(false);
  expect(next.accept(next.event("ready"))).toBe(true);
  for (const index of workflow.steps.keys()) {
    expect(next.accept(next.event("stepStarted", index))).toBe(true);
    expect(next.accept(next.event("stepFinished", index))).toBe(true);
  }
  expect(next.accept(next.event("completed"))).toBe(true);
  expect(next.count).toBe(workflow.steps.length);
  expect(next.accept(next.event("closed"))).toBe(true);
});
