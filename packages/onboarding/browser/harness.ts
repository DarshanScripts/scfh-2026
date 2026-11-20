import { isAnswer, isCitation, isWalkthrough, type Passage, type ReadyWorkflow } from "./contracts";
import { exportDiagram, PlaybackRun, renderDiagram, workflowScene } from "./diagram";
import { preview } from "./preview";

const query = document.querySelector<HTMLInputElement>("#query")!;
const form = document.querySelector<HTMLFormElement>("#question-form")!;
const answer = document.querySelector("#answer")!;
const citations = document.querySelector("#citations")!;
const previewPanel = document.querySelector<HTMLElement>("#source")!;
const sourceTitle = document.querySelector("#source-title")!;
const sourceStatus = document.querySelector("#source-status")!;
const sourceBody = document.querySelector<HTMLElement>("#source-body")!;
const workflowPanel = document.querySelector<HTMLElement>("#workflow")!;
const workflowTitle = document.querySelector("#workflow-title")!;
const diagram = document.querySelector<HTMLElement>("#diagram")!;
const narration = document.querySelector("#narration")!;
const stop = document.querySelector<HTMLButtonElement>("#stop")!;
const save = document.querySelector<HTMLButtonElement>("#save")!;
let sourceSequence = 0;
let responseSequence = 0;
let run: PlaybackRun | undefined;

async function post(path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Request failed");
  return response.json();
}

async function openCitation(requestId: string, passage: Passage) {
  const sequence = ++sourceSequence;
  previewPanel.hidden = false;
  sourceTitle.textContent = passage.title;
  sourceStatus.textContent = "Opening source…";
  const page = document.createElement("div");
  sourceBody.replaceChildren(page);
  try {
    const source = await post("/api/citation", { schemaVersion: 1, requestId, passageId: passage.passageId });
    if (sequence !== sourceSequence) return;
    if (!isCitation(source) ||
        (source.status !== "unavailable" && !/^\/sources\/[a-z0-9-]+\?revision=[a-f0-9]{64}$/.test(source.sourceUrl))) {
      throw new Error("Invalid source");
    }
    const message = await preview(source, page);
    if (sequence === sourceSequence) sourceStatus.textContent = message;
  } catch {
    if (sequence === sourceSequence) sourceStatus.textContent = "The source document is unavailable.";
  }
}

function showCitations(requestId: string, passages: Passage[]) {
  citations.replaceChildren();
  for (const passage of passages) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "citation";
    link.dataset.passage = passage.passageId;
    const page = passage.locator.pageLabel ||
      (passage.locator.format === "pdf" ? String(passage.locator.page) : "");
    link.textContent = [passage.title, passage.sectionPath.join(" › "), page ? "p. " + page : ""]
      .filter(Boolean).join(" · ");
    link.addEventListener("click", () => void openCitation(requestId, passage));
    citations.append(link);
  }
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function play(workflow: ReadyWorkflow) {
  if (run?.state === "completed") {
    answer.textContent = "Close the completed walkthrough to start another.";
    return;
  }
  if (run) run.accept(run.event("cancelled"));
  const active = new PlaybackRun(workflow);
  run = active;
  workflowPanel.hidden = false;
  workflowTitle.textContent = workflow.title;
  stop.disabled = false;
  save.disabled = true;
  diagram.replaceChildren();
  diagram.dataset.count = "0";
  active.accept(active.event("ready"));

  try {
    for (const [index, step] of workflow.steps.entries()) {
      if (!active.accept(active.event("stepStarted", index))) return;
      narration.textContent = step.narration;
      const view = await renderDiagram(workflowScene(workflow, active.count));
      if (run !== active || active.state !== "playing") return;
      diagram.replaceChildren(view);
      diagram.dataset.count = String(active.count);
      await delay(1350);
      if (!active.accept(active.event("stepFinished", index))) return;
    }
    if (run === active && active.accept(active.event("completed"))) {
      narration.textContent = "Walkthrough complete.";
      stop.disabled = true;
      save.disabled = false;
    }
  } catch {
    if (run === active && active.accept(active.event("failed"))) {
      narration.textContent = "The diagram could not be rendered.";
      answer.textContent = workflow.steps.map(step => step.narration).join(" ");
      stop.disabled = true;
    }
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const sequence = ++responseSequence;
  const walkthrough = event.submitter?.id === "walkthrough-button";
  answer.textContent = "Searching approved sources…";
  citations.replaceChildren();
  try {
    const payload = await post(walkthrough ? "/api/walkthrough" : "/api/question", { query: query.value });
    if (responseSequence !== sequence) return;
    if (walkthrough && isWalkthrough(payload)) {
      if (payload.outcome === "ready") {
        answer.textContent = payload.title;
        showCitations(payload.requestId, payload.citations);
        void play(payload);
      } else {
        answer.textContent = payload.text;
      }
      return;
    }
    if (!walkthrough && isAnswer(payload)) {
      answer.textContent = payload.text;
      showCitations(payload.requestId, payload.citations);
      return;
    }
  } catch {
    if (responseSequence !== sequence) return;
  }
  answer.textContent = "The knowledge service is unavailable. Try again.";
});

document.querySelectorAll<HTMLButtonElement>("[data-query]").forEach(button => {
  button.addEventListener("click", () => {
    query.value = button.dataset.query!;
    form.requestSubmit(document.querySelector<HTMLButtonElement>("#ask-button"));
  });
});

stop.addEventListener("click", () => {
  if (run?.accept(run.event("cancelled"))) {
    narration.textContent = "Walkthrough interrupted.";
    stop.disabled = true;
  }
});

document.querySelector("#close-workflow")!.addEventListener("click", () => {
  if (run) run.accept(run.event("closed"));
  run = undefined;
  workflowPanel.hidden = true;
  diagram.replaceChildren();
});

document.querySelector("#close-source")!.addEventListener("click", () => {
  sourceSequence++;
  previewPanel.hidden = true;
  sourceBody.replaceChildren();
});

save.addEventListener("click", async () => {
  const active = run;
  if (active?.state !== "completed") return;
  save.disabled = true;
  try {
    const png = await exportDiagram(workflowScene(active.workflow, active.count));
    if (run !== active) return;
    const url = URL.createObjectURL(png);
    const download = document.createElement("a");
    download.href = url;
    download.download = active.workflow.workflowId + ".png";
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    if (run === active) narration.textContent = "The PNG could not be saved. Try again.";
  } finally {
    if (run === active) save.disabled = false;
  }
});
