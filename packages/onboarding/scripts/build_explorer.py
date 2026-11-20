"""Regenerate the HTML explorer from the current fixture data."""
from collections import Counter
from datetime import datetime
from html import escape as e
import json
from pathlib import Path
import re

WORKSPACE = Path(__file__).resolve().parents[3]
root = WORKSPACE / "packages/onboarding/src/onboarding/fixtures"
knowledge = json.loads((root / "knowledge.json").read_text())
sources = json.loads((root / "sources.json").read_text())
queue = json.loads((root / "queue.json").read_text())
interviews = (root / "handover.md").read_text()
docs = {doc["documentId"]: doc for doc in sources["documents"]}
passages = {passage["passageId"]: passage for passage in sources["passages"]}
counts = Counter(review["disposition"] for review in knowledge["reviews"])


def tag(status):
    return f'<span class="pill {e(status)}">{e(status.title())}</span>'


def links(ids):
    return '<div class="links">' + "".join(
        f'<a href="#passage-{e(key)}">{e(key)}</a>' for key in ids
    ) + '</div>'


def turn_links(ids):
    return '<div class="links">' + "".join(
        f'<a href="#turn-{e(key)}">{e(key)}</a>' for key in ids
    ) + '</div>'


def raw(data, label):
    return f'<details><summary>{e(label)}</summary><pre>{e(json.dumps(data, indent=2, ensure_ascii=False))}</pre></details>'


def doc_link(doc, locator=None):
    url = (root / doc["relativePath"]).relative_to(WORKSPACE)
    fragment = f'#page={locator["page"]}' if locator and locator["format"] == "pdf" else ""
    return f'<a href="{e(url.as_posix())}{fragment}">Open {doc["format"].upper()}</a>'


def deadline(value):
    if not value:
        return "No deadline"
    date = datetime.fromisoformat(value)
    return date.strftime("%d %b %Y · %H:%M") + " Berlin time"


parts = []
parts.append("""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Facilities Service Desk · Knowledge Explorer</title>
<style>
:root {color:#172b2e;background:#f3f5f1;font:16px/1.55 system-ui,sans-serif;--ink:#172b2e;--muted:#526764;--line:#d6dfd8;--green:#166650;--paper:#fff;--soft:#e0ece5}
*{box-sizing:border-box}
body{margin:0}
header{background:#123a33;color:#f5faf5;padding:clamp(2.5rem,7vw,5.6rem) 1.5rem 3rem}
.wrap{max-width:1140px;margin:auto}
header p{color:#bfd9cf;max-width:41rem;margin:.6rem 0 0}
.kicker{margin:0;color:#9bd5b7;font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700}
h1{font-size:clamp(2.25rem,6vw,4.15rem);line-height:1.06;letter-spacing:-.055em;margin:.45rem 0;font-weight:750}
nav{position:sticky;top:0;z-index:2;background:#f3f5f1f5;border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}
nav .wrap{display:flex;gap:1rem 1.45rem;flex-wrap:wrap;padding:.8rem 1.5rem}
a{color:var(--green);text-underline-offset:.2em}
nav a{font-size:.9rem;font-weight:650;text-decoration:none}
a:hover{text-decoration:underline}
main{padding:1.7rem 1.5rem 5rem}
section{scroll-margin-top:5.5rem;margin-bottom:3.25rem}
article,details,[id^="turn-"]{scroll-margin-top:5.5rem}
h2{font-size:clamp(1.55rem,4vw,2.1rem);letter-spacing:-.035em;margin:0 0 .35rem}
h3{font-size:1.07rem;margin:0 0 .45rem}
p{margin:.45rem 0}
.lead,.muted{color:var(--muted)}
.lead{margin:0 0 1.15rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(245px,100%),1fr));gap:.85rem}
.two{grid-template-columns:repeat(auto-fit,minmax(min(350px,100%),1fr))}
.card{border:1px solid var(--line);border-radius:.8rem;background:var(--paper);padding:1.15rem;min-width:0}
.stat{display:block;font-size:1.9rem;line-height:1;color:var(--green);font-weight:760}
.stats .card{padding:1rem}
.card:target,.step:target{outline:3px solid #3ba57c;outline-offset:2px}
code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}
.label{font-size:.77rem;color:var(--muted);font-weight:650;letter-spacing:.025em}
.pill{display:inline-block;background:var(--soft);color:#214e40;padding:.14rem .58rem;border-radius:1rem;font-size:.77rem;font-weight:700}
.pending,.conflict,.gap{background:#faead2;color:#814a14}
.upcoming,.decision{background:#dfedf4;color:#205374}
.superseded,.excluded,.duplicate{background:#eff0eb;color:#525c54}
.links{display:flex;gap:.4rem .8rem;flex-wrap:wrap;overflow-wrap:anywhere;margin:.55rem 0}
.links a{font-size:.85rem}
blockquote{margin:.65rem 0;padding:.45rem 0 .45rem .8rem;border-left:3px solid #aaccb8}
details{border-top:1px solid var(--line);margin-top:.75rem;padding-top:.6rem}
summary{color:var(--green);cursor:pointer;font-weight:650;font-size:.88rem}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf3ee;padding:.8rem;border-radius:.45rem;font-size:.8rem}
.bar{display:flex;align-items:end;gap:.75rem;flex-wrap:wrap;margin:.85rem 0}
label{display:grid;gap:.2rem;color:var(--muted);font-size:.8rem;font-weight:650}
input,select{font:inherit;font-size:.92rem;color:var(--ink);background:white;border:1px solid #9db3a9;border-radius:.4rem;padding:.5rem .7rem}
input{min-width:min(19rem,75vw)}
.step{display:grid;grid-template-columns:2rem 1fr;gap:.75rem;padding:.9rem 0;border-top:1px solid var(--line)}
.step-no{width:1.9rem;height:1.9rem;border-radius:50%;text-align:center;line-height:1.9rem;background:var(--soft);font-weight:700;color:var(--green)}
footer{background:#e2eae3;color:var(--muted);padding:1.3rem 1.5rem}
</style>
</head>
<body>
<header><div class="wrap"><p class="kicker">Municipal Facilities Service Desk</p><h1>Onboarding data explorer</h1><p>Inspect the synthetic records behind the demo, from open tickets and reviewed handovers to the exact passages an answer cites.</p></div></header>
<nav aria-label="Sections"><div class="wrap"><a href="#queue">Queue</a><a href="#claims">Answers</a><a href="#sources">Sources</a><a href="#reviews">Handover review</a><a href="#workflow">Walkthrough</a></div></nav>
<main class="wrap">""")
parts.append('<section class="grid stats" aria-label="Data counts">')
for count, title in [(len(docs), "Source documents"), (len(passages), "Citation passages"), (len(knowledge["claims"]), "Approved claims"), (len(knowledge["reviews"]), "Review records")]:
    parts.append(f'<div class="card"><span class="stat">{count}</span>{title}</div>')
parts.append('</section>')
parts.append(f'<section id="queue"><h2>Task queue</h2><p class="lead">Snapshot taken on {e(queue["asOf"])}. Each ticket has an owner and a next action.</p><div class="grid">')
for item in queue["items"]:
    parts.append(f'<article class="card"><p class="label">{e(item["ticketId"])} · {e(item["priority"].title())} priority</p>'
                 f'<h3>{e(item["summary"])}</h3>{tag(item["status"])}'
                 f'<p><strong>{e(item["ownerRole"])}</strong><br>{e(deadline(item["deadline"]))}</p>'
                 f'<p class="muted">{e(item["nextAction"])}</p>'
                 f'<p>{e(item.get("building", ""))} · {e(item.get("room") or "Room unconfirmed")}</p>'
                 f'<p class="muted">{e(item.get("waitingOn") or "")}</p>{raw(item, "Ticket history and fields")}</article>')
parts.append('</div><details><summary>Location identifiers</summary><ul>')
for loc in knowledge["locations"]:
    parts.append(f'<li>{e(loc["label"])} · <code>{e(loc["locationId"])}</code> · {e(loc["kind"])}</li>')
parts.append('</ul><p class="muted">The Windows app maps these identifiers to its local destinations.</p></details></section>')

parts.append('<section id="claims"><h2>Answers and evidence</h2><p class="lead">Open a passage link to see its original quote and locator. Expand a claim to inspect the retrieval cues.</p><div class="grid two">')
for claim in knowledge["claims"]:
    cues = [topic for topic in knowledge["topics"] if claim["claimId"] in topic["claimIds"]]
    parts.append(f'<article class="card"><h3>{e(claim["claimId"].replace("-", " ").capitalize())}</h3>'
                 f'<p>{e(claim["text"])}</p>{links(claim["passageIds"])}{raw(cues, "Retrieval cue groups")}</article>')
parts.append('</div></section>')

parts.append('<section id="sources"><h2>Source passages</h2><p class="lead">Every citation includes a document revision, a quote, and a page or paragraph range. Compare the two Desk Lead reminders to see how identical text points to different headings.</p><div class="grid two">')
for doc in docs.values():
    parts.append(f'<article class="card"><h3>{e(doc["title"])}</h3><p class="label">{e(doc["documentId"])}</p>{doc_link(doc)}{raw(doc, "Document metadata")}</article>')
parts.append('</div><div class="bar"><label>Search passages<input id="filter" type="search" placeholder="Find a quote, heading or ID"></label><label>Document<select id="doc"><option value="">All documents</option>')
for key, doc in docs.items():
    parts.append(f'<option value="{e(key)}">{e(doc["title"])}</option>')
parts.append('</select></label><p id="matches" class="label" role="status"></p></div><div class="grid two" id="passages">')
for key, passage in passages.items():
    loc = passage["locator"]
    location = f'Page {loc["page"]}' if loc["format"] == "pdf" else f'Paragraph {loc["paragraphOrdinal"]} under {" › ".join(loc["headingPath"])}'
    parts.append(f'<article class="card" id="passage-{e(key)}" data-document="{e(passage["documentId"])}">'
                 f'<p class="label">{e(passage["title"])}</p><h3>{e(" › ".join(passage["sectionPath"]))}</h3>'
                 f'<blockquote>{e(passage["quote"])}</blockquote><p class="muted">{e(location)} · offsets [{loc["start"]}, {loc["end"]})</p>'
                 f'<p><code>{e(key)}</code></p>{doc_link(docs[passage["documentId"]], loc)}{raw(passage, "Citation JSON")}</article>')
parts.append('</div></section>')

parts.append('<section id="reviews"><h2>Handover review</h2><p class="lead">The review records show which advice is searchable, which was superseded, and where the two departing employees disagreed.</p>')
parts.append('<div class="links">' + ''.join(f'<span class="pill {e(status)}">{count} {e(status)}</span>' for status,count in counts.items()) + '</div><div class="grid two">')
for review in knowledge["reviews"]:
    parts.append(f'<article class="card" id="review-{e(review["recordId"])}">{tag(review["disposition"])}'
                 f'<h3>{e(review["recordId"].replace("-", " ").capitalize())}</h3>'
                 f'<p>{e(review["reason"])}</p><p class="muted">{e(review["applicability"])} · {e(review["reviewerRole"])}</p>')
    if review.get("canonicalRecordId"):
        k = review["canonicalRecordId"]
        parts.append(f'<p><a href="#review-{e(k)}">Open the current review record</a></p>')
    parts.append(links(review.get("passageIds", [])) + turn_links(review.get("interviewTurnIds", []) + review.get("meetingTurnIds", [])) + '</article>')
parts.append('</div><h3 style="margin-top:1.4rem">Interview turns</h3><div class="grid two">')
meeting = (root / "operations-meeting.md").read_text()
meeting_header = "**20 November 2026 · Facilities operations review**\n"
meeting_body = meeting[meeting.index("### meeting-access-window"):]
interviews += "\n## Interview Meeting\n" + meeting_header + meeting_body
for block in re.split(r'^## Interview ', interviews, flags=re.M)[1:]:
    chunks = re.split(r'^### ([a-z0-9-]+)\n', block, flags=re.M)
    speaker = re.search(r'\*\*(.+)\*\*', chunks[0]).group(1)
    for index in range(1, len(chunks), 2):
        key, body = chunks[index:index + 2]
        parts.append(f'<article class="card" id="turn-{e(key)}"><p class="label">{e(speaker)}</p>'
                     f'<details><summary>{e(key.replace("-", " ").capitalize())}</summary><p>{e(body.strip())}</p></details></article>')
parts.append('</div></section>')

workflow = knowledge["workflow"]
steps = {step["stepId"]: step for step in workflow["steps"]}
parts.append(f'<section id="workflow"><h2>{e(workflow["title"])}</h2><p class="lead">The same ordered steps drive narration and drawing. Follow a branch to see its destination and supporting source.</p>')
for number, step in enumerate(steps.values(), 1):
    parts.append(f'<article class="step" id="step-{e(step["stepId"])}"><span class="step-no">{number}</span><div>'
                 f'<h3>{e(step["label"])}</h3>{tag(step["kind"])}<p>{e(step["narration"])}</p>'
                 + links(step["passageIds"]))
    if step["edges"]:
        parts.append('<div class="links">' + ''.join(
            f'<a href="#step-{e(edge["toStepId"])}">{e(edge["label"])} → {e(steps[edge["toStepId"]]["label"])}</a>'
            for edge in step["edges"]
        ) + '</div>')
    parts.append('</div></article>')
parts.append("""</section></main>
<footer><div class="wrap">Read-only snapshot of the onboarding fixtures. Open the source links to inspect the original documents.</div></footer>
<script>
const filter = document.querySelector("#filter");
const doc = document.querySelector("#doc");
const cards = Array.from(document.querySelectorAll("#passages article"));
const matches = document.querySelector("#matches");
function update() {
  const query = filter.value.toLowerCase().trim();
  let count = 0;
  for (const card of cards) {
    card.hidden = Boolean((doc.value && card.dataset.document !== doc.value) || !card.textContent.toLowerCase().includes(query));
    if (!card.hidden) count++;
  }
  matches.textContent = count + (count === 1 ? " passage" : " passages");
}
function showTarget() {
  const target = document.getElementById(location.hash.slice(1));
  if (!target) return;
  if (target.hidden && target.dataset.document) {
    filter.value = "";
    doc.value = "";
    update();
    target.scrollIntoView();
  }
  const turn = target.id.startsWith("turn-") && target.querySelector("details");
  if (turn) turn.open = true;
}
filter.addEventListener("input", update);
doc.addEventListener("change", update);
window.addEventListener("hashchange", showTarget);
update();
showTarget();
</script>
</body>
</html>""")
(WORKSPACE / "onboarding-data.html").write_text("\n".join(parts) + "\n", encoding="utf-8")

from pathlib import Path
import json
p=WORKSPACE / 'onboarding-data.html'
s=p.read_text()
r=root
data={name:json.loads((r/(name+'.json')).read_text()) for name in ('knowledge','sources')}
script_data=json.dumps(data,ensure_ascii=False).replace('<','\\u003c')
css='''
.graph-scroll{overflow:auto;border:1px solid var(--line);border-radius:.7rem;background:#f8faf7}
.graph-board{position:relative;min-width:1100px;width:1100px}
.graph-node{position:absolute;width:190px;min-height:90px;text-align:left;padding:.7rem;border:1px solid #a9bfb2;border-radius:.6rem;background:white;color:var(--ink);cursor:pointer;font:inherit;font-size:.88rem;z-index:1}
.graph-node strong{display:block;font-size:.95rem;overflow-wrap:anywhere}
.graph-node small{display:block;color:var(--muted);margin-top:.3rem}
.graph-node:hover,.graph-node:focus{outline:3px solid #78b79b;outline-offset:1px}
.graph-node.chosen{background:#e1f0e7}
.graph-label{position:absolute;top:12px;font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.graph-board svg{position:absolute;inset:0;pointer-events:none}
.graph-detail{margin-top:.8rem;background:#edf4ee;border-radius:.6rem;padding:1rem}
.graph-detail pre{max-height:19rem;overflow:auto}
.flow-strip{display:flex;align-items:stretch;gap:.5rem;overflow:auto;padding:.5rem 0 1rem}
.flow-item{flex:1 0 155px;max-width:210px;border:1px solid var(--line);background:white;border-radius:.5rem;padding:.8rem}
.flow-item strong{display:block;line-height:1.25;margin-bottom:.4rem}
.flow-item p{font-size:.85rem;color:var(--muted)}
.flow-arrow{align-self:center;color:var(--green);font-size:1.5rem}
.flow-pending{border-style:dashed;background:#f6f6ef}
'''
s=s.replace('</style>',css+'</style>',1)
s=s.replace('<a href="#queue">Queue</a>','<a href="#relationships">Relationships</a><a href="#data-flow">Data flow</a><a href="#queue">Queue</a>',1)
section='''
<section id="relationships">
<h2>How the records connect</h2>
<p class="lead">Choose a claim to trace its interview provenance and cited evidence. Choose a review record to inspect duplicates, superseded advice, or unresolved conflicts. Click a node for its actual data.</p>
<div class="bar"><label>Trace<select id="trace-mode"><option value="claim">Approved answer claim</option><option value="review">Handover review record</option><option value="step">Workflow step</option></select></label><label>Record<select id="trace-record"></select></label></div>
<p class="muted" id="trace-caption" role="status"></p>
<div class="graph-scroll"><div id="relation-board" class="graph-board" role="group" aria-label="Data relationships"></div></div>
<div id="relation-detail" class="graph-detail" aria-live="polite">Select a node to inspect its fields.</div>
</section>
<section id="data-flow">
<h2>How a question becomes a cited answer</h2>
<p class="lead">The current fixture implementation matches topic cues and assembles approved claim text. Review records retain the decision and provenance behind each claim.</p>
<div class="flow-strip" aria-label="Question and answer flow">
<div class="flow-item"><strong>Employee question</strong><p>Everyday language enters the local demo or avatar tool.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Validate input</strong><p>Check query length, request ID, and turn ID.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Match topic cues</strong><p>Find the approved claims that cover each part of the question.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Attach evidence</strong><p>Claim → passage IDs → quotes, source revisions, and locators.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Answer and citations</strong><p>Show the supported text and identify any uncovered part.</p></div>
</div>
<h3>When a citation is clicked</h3>
<div class="flow-strip" aria-label="Citation resolution flow">
<div class="flow-item"><strong>Request + passage ID</strong><p>Resolve the citation from the stored answer.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Registered document</strong><p>Check the file revision and resolve its approved source path.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Navigate</strong><p>Open the PDF page or the Word heading and paragraph.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Verify the quote</strong><p>Compare the cited range with the rendered source text.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Highlight or explain</strong><p>Highlight the verified passage. If verification fails, explain the fallback.</p></div>
</div>
<h3>When a walkthrough is requested</h3>
<div class="flow-strip" aria-label="Walkthrough flow">
<div class="flow-item"><strong>Approved workflow</strong><p>Retrieve ordered steps with branches and supporting passage IDs.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>One step record</strong><p>Its narration supplies the words. Its ID supplies the scene elements.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Linux harness</strong><p>Simulated playback events reveal the cumulative Excalidraw scene.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item flow-pending"><strong>Windows integration</strong><p>Member 1 connects real avatar playback to the MCP App reveal events.</p></div><span class="flow-arrow" aria-hidden="true">→</span>
<div class="flow-item"><strong>Completed scene</strong><p>Export every node and connector to PNG. Close dismisses the panel.</p></div>
</div>
</section>
'''
s=s.replace('<section class="grid stats"',section+'<section class="grid stats"',1)
js='''
const dataset = DATA;
const byId = (items, field) => new Map(items.map(item => [item[field], item]));
const claimsById = byId(dataset.knowledge.claims, 'claimId');
const reviewsById = byId(dataset.knowledge.reviews, 'recordId');
const passagesById = byId(dataset.sources.passages, 'passageId');
const docsById = byId(dataset.sources.documents, 'documentId');
const mode = document.querySelector('#trace-mode');
const choice = document.querySelector('#trace-record');
const board = document.querySelector('#relation-board');
const detail = document.querySelector('#relation-detail');
const caption = document.querySelector('#trace-caption');
const svgNS = 'http://www.w3.org/2000/svg';
function svgElement(tag, attributes) {
  const node = document.createElementNS(svgNS,tag);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
  return node;
}
function populate() {
  const records = mode.value === 'claim' ? dataset.knowledge.claims : mode.value === 'review' ? dataset.knowledge.reviews : dataset.knowledge.workflow.steps;
  const field = mode.value === 'claim' ? 'claimId' : mode.value === 'review' ? 'recordId' : 'stepId';
  choice.replaceChildren(...records.map(record => new Option(record[field].replaceAll('-',' '),record[field])));
  if (mode.value === 'claim') choice.value = 'duplicate-tip';
  if (mode.value === 'review') choice.value = 'vendor-callback';
  drawRelations();
}
function inspect(node) {
  board.querySelectorAll('button').forEach(button => button.classList.toggle('chosen',button.dataset.key === node.key));
  const heading = document.createElement('h3'); heading.textContent = node.label;
  const code = document.createElement('pre'); code.textContent = JSON.stringify(node.data,null,2);
  detail.replaceChildren(heading,code);
  if (node.anchor && document.getElementById(node.anchor)) {
    const link = document.createElement('a'); link.href = '#' + node.anchor; link.textContent = 'Open this record below'; detail.append(link);
  }
}
function drawRelations() {
  const nodes = new Map(); const edges = [];
  function add(key,column,label,kind,data,anchor) {
    if (!nodes.has(key)) nodes.set(key,{key,column,label,kind,data,anchor});
    return key;
  }
  function edge(from,to,label) { if (!edges.some(e => e.from===from && e.to===to && e.label===label)) edges.push({from,to,label}); }
  function source(id,from,verb) {
    const passage = passagesById.get(id); if (!passage) return;
    const key = add('passage-'+id,3,id,'Passage',passage,'passage-'+id);
    edge(from,key,verb);
    const doc = docsById.get(passage.documentId);
    if (doc) edge(key,add('doc-'+doc.documentId,4,doc.title,doc.format.toUpperCase(),doc),'located in');
  }
  function review(record) {
    const key=add('review-'+record.recordId,1,record.recordId,'Review · '+record.disposition,record,'review-'+record.recordId);
    for (const id of [...(record.interviewTurnIds || []), ...(record.meetingTurnIds || [])]) {
      const text=document.getElementById('turn-'+id)?.textContent.trim() || id;
      edge(add('turn-'+id,0,id,id.startsWith('meeting-') ? 'Meeting turn' : 'Interview turn',{turnId:id,text},'turn-'+id),key,'reviewed in');
    }
    return key;
  }
  let selectedKey;
  if (mode.value === 'claim') {
    const claim=claimsById.get(choice.value);
    selectedKey=add('claim-'+claim.claimId,2,claim.claimId,'Approved claim',claim);
    const record=reviewsById.get(claim.claimId);
    if(record) edge(review(record),selectedKey,'approves');
    for(const id of claim.passageIds) source(id,selectedKey,'cites');
    caption.textContent='Interview turns → review decision → approved claim → cited passage → original document. Some claims originate directly in a documented procedure.';
  } else if (mode.value === 'review') {
    const record=reviewsById.get(choice.value); selectedKey=review(record);
    const approved=claimsById.get(record.recordId);
    if (approved && record.disposition==='approved') {
      const key=add('claim-'+approved.claimId,2,approved.claimId,'Approved claim',approved);
      edge(selectedKey,key,'approves'); for(const id of approved.passageIds) source(id,key,'cites');
    } else {
      for(const id of record.passageIds || []) source(id,selectedKey,'references');
      const canonical=reviewsById.get(record.canonicalRecordId);
      if(canonical) {
        const key=add('canonical-'+canonical.recordId,2,canonical.recordId,'Current approved review',canonical,'review-'+canonical.recordId);
        edge(selectedKey,key,record.disposition==='duplicate'?'merged into':'superseded by');
        for(const id of canonical.passageIds) source(id,key,'retains source');
      }
    }
    caption.textContent=record.disposition==='conflict'?'Both employee accounts remain in the review record. The cited guide identifies the documented gap and the next action.':record.reason;
  } else {
    const step=dataset.knowledge.workflow.steps.find(step=>step.stepId===choice.value);
    selectedKey=add('step-'+step.stepId,2,step.label,'Workflow · '+step.kind,step,'step-'+step.stepId);
    for(const id of step.passageIds) source(id,selectedKey,'supported by');
    caption.textContent='A workflow step carries narration, branch destinations, and evidence. Its passage IDs connect it to the same sources used for answers.';
  }
  const grouped=Array.from({length:5},(_,i)=>[...nodes.values()].filter(node=>node.column===i));
  const height=Math.max(245,80+Math.max(...grouped.map(group=>group.length))*125);
  board.style.height=height+'px'; board.replaceChildren();
  const svg=svgElement('svg',{width:1100,height,viewBox:'0 0 1100 '+height,'aria-hidden':'true'});
  const defs=svgElement('defs',{}); const marker=svgElement('marker',{id:'graph-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
  marker.append(svgElement('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#638d79'})); defs.append(marker);svg.append(defs);board.append(svg);
  const headings=['Interviews / meeting','Review decisions',mode.value==='step'?'Workflow step':'Approved records','Passages','Documents'];
  grouped.forEach((group,column)=>{
    const label=document.createElement('span');label.className='graph-label';label.style.left=(column*220+10)+'px';label.textContent=headings[column];board.append(label);
    group.forEach((node,index)=>{
      node.x=column*220+10;node.y=55+index*125;
      const button=document.createElement('button');button.type='button';button.className='graph-node';button.dataset.key=node.key;
      button.style.left=node.x+'px';button.style.top=node.y+'px';
      const strong=document.createElement('strong');strong.textContent=node.label.replaceAll('-',' ');
      const small=document.createElement('small');small.textContent=node.kind;
      button.append(strong,small);button.addEventListener('click',()=>inspect(node));board.append(button);
    });
  });
  for(const item of edges){
    const a=nodes.get(item.from),b=nodes.get(item.to); const x=a.x+190,y=a.y+46,u=b.x,v=b.y+46;
    svg.append(svgElement('path',{d:'M '+x+' '+y+' C '+(x+38)+' '+y+', '+(u-38)+' '+v+', '+u+' '+v,stroke:'#638d79','stroke-width':1.7,fill:'none','marker-end':'url(#graph-arrow)'}));
  }
  inspect(nodes.get(selectedKey));
}
mode.addEventListener('change',populate);choice.addEventListener('change',drawRelations);populate();
'''.replace('DATA',script_data,1)
s=s.replace('</body>','<script>'+js+'</script></body>',1)
p.write_text(s)
