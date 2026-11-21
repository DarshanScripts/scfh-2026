const icon = name => `<span class="icon" aria-hidden="true">${window.PitchIcons[name]}</span>`;
const brand = '<img class="brand-mark" src="assets/orange-whisky.png" alt="">';
const people = 'Aditya Ladawa <span>·</span> Darshan Shah';
const stats = 'https://www.destatis.de/DE/Themen/Staat/Oeffentlicher-Dienst/Tabellen/beschaeftigen-alter.html';
const berlin = 'https://www.berlin.de/vak/inhouse/wissenstransfer/';
const notes = text => `<aside class="notes">${text}</aside>`;
const checkpoints = count => Array.from({ length: count }, (_, index) =>
  `<span class="fragment custom checkpoint" data-fragment-index="${index}" aria-hidden="true"></span>`).join('');

const problemCues = ['Facilities Service Desk', 'Experience builds up', 'Expert leaves', 'New colleague joins', 'How do I start?'];
const solutionCues = ['Reviewed guidance', 'Ask by voice', 'Hear the answer', 'Open the evidence', 'Watch each step', 'Open the folder'];

function cueText(cues) {
  return `<p class="cue-text" aria-live="polite">${cues[0]}</p>`;
}

function problem() {
  return `<header class="scene-heading"><h2>Who knows<br>what to do?</h2>${cueText(problemCues)}</header>
    <div class="problem-scene">
      <div class="office-frame" aria-hidden="true"><div class="office-window"></div></div>
      <div class="desk" aria-hidden="true"></div>
      <div class="expert" data-from="1">
        <span class="portrait">${icon('person')}<span class="exit-mark" data-from="2">${icon('cross')}</span></span>
        <p>Experienced colleague</p>
        <ul class="know-how"><li>Context</li><li>Methods</li><li>Experience</li></ul>
      </div>
      <div class="newcomer" data-from="3">
        <span class="portrait">${icon('person')}</span>
        <p>New colleague</p>
      </div>
      <div class="empty-files" data-from="4" aria-label="The new colleague is missing the practical know-how">${icon('folder')}<b>?</b></div>
    </div>${checkpoints(4)}`;
}

function answerList() {
  return `<ul class="answer-list"><li>${icon('check')}Building and room</li><li>${icon('check')}Issue summary</li><li>${icon('check')}Callback channel</li></ul>`;
}

function diagram() {
  return `<div class="mini-flow">
    <div>${icon('check')}Check details</div>${icon('arrow')}
    <div>${icon('search')}Check duplicates</div>${icon('arrow')}
    <div>${icon('folder')}Route ticket</div>
  </div>`;
}

function solution() {
  const scenes = [
    `<div class="guide-art">${icon('document')}${icon('document')}${icon('book')}</div><h3>Approved guides</h3>`,
    `<div class="relay-orb"><img src="assets/orb.png" alt=""></div><h3>“What do I need?”</h3>`,
    answerList(),
    `<div class="evidence-page">${icon('document')}<h3>Maintenance Intake Guide</h3><p>Intake checklist · p. 2</p><mark>Building and room</mark></div>`,
    diagram(),
    `<div class="folder-art">${icon('monitor')}${icon('folder')}${icon('cursor')}</div><h3>Facilities onboarding folder</h3>`
  ];
  return `<header class="scene-heading"><h2>First maintenance<br>request</h2>${cueText(solutionCues)}</header>
    <ol class="workflow" aria-label="Onboarding workflow">
      ${solutionCues.slice(1).map((label, index) =>
        `<li data-from="${index + 1}"><span class="workflow-dot" aria-hidden="true"></span>${label}</li>`).join('')}
    </ol>
    <div class="solution-scene">
      ${scenes.map((html, index) => `<div class="scene scene-${index}" data-scene="${index}">${html}</div>`).join('')}
    </div>${checkpoints(5)}`;
}

function slideProgress(current) {
  return `<div class="slide-progress" aria-hidden="true">${Array.from({ length: 6 }, (_, i) =>
    `<span${i === current ? ' class="active"' : ''}></span>`).join('')}</div>`;
}

document.querySelector('.slides').innerHTML = `
  <section id="intro" class="cover" aria-label="Relay by Team Orange Whisky">
    <div class="cover-assembly" aria-hidden="true"><i></i><i></i><i></i>${brand}</div>
    <div class="cover-copy"><h1>Relay</h1><p class="team-name">Orange Whisky</p><p class="team-names">${people}</p></div>
    ${slideProgress(0)}
    ${notes('We’re Aditya Ladawa and Darshan Shah, Team Orange Whisky. Relay is our name for the Facilities Voice Agent pitch. It addresses Challenge 2, The Memory of Public Administration.')}
  </section>
  <section id="problem" class="problem" data-step="0" aria-label="Knowledge lost when staff leave">
    ${problem()}${slideProgress(1)}
    ${notes(`Start on the empty Facilities Service Desk. Pause after each click.
      <ol><li>The experienced colleague knows how requests are actually handled, including which details matter and where to look first.</li>
      <li>The colleague leaves. The cross marks their departure. The practical know-how moves with them.</li>
      <li>A new colleague joins the same desk. A routine maintenance request comes in.</li>
      <li>“What do I need before I open a maintenance ticket?” The everyday work continues even when its practical context is missing.</li></ol>`)}
  </section>
  <section id="facts" class="facts" aria-label="1.42 million public-service staff aged 55 or older">
    <h2>Public service</h2>
    <div class="stat-composition">
      <p class="stat-number">1.42 <span>million</span></p>
      <div class="stat-context"><p>Staff aged 55+</p><p>Germany · June 2024</p></div>
    </div>
    <p class="sources"><a href="${stats}" target="_blank" rel="noopener">Destatis · 2024</a></p>
    ${slideProgress(2)}
    ${notes(`“In June 2024, 1.42 million people working in Germany’s public service were aged 55 or older.” Destatis reports 747,200 aged 55–59 and 669,400 aged 60 or older. This statistic measures the age profile of staff. Berlin’s Administrative Academy separately identifies retirement and role changes as drivers of lost expertise. <a href="${stats}">Destatis age table</a> · <a href="${berlin}">Berlin guidance</a>`)}
  </section>
  <section id="solution" class="solution" data-step="0" aria-label="A new colleague uses Relay to handle a maintenance request">
    ${solution()}${slideProgress(3)}
    ${notes(`Start with the approved guides and reviewed handover examples already available to Relay. This scenario uses the fictional Facilities Service Desk corpus.
      <ol><li>The new colleague asks, “What do I need before I open a maintenance ticket?”</li>
      <li>Relay answers by voice in the Windows sidebar. Collect the building and room or location, an issue summary, and a callback channel. If a source doesn’t cover part of a question, the assistant says so.</li>
      <li>Click the citation to highlight the exact passage in the sample PDF on page 2. Relay also supports Word passages.</li>
      <li>“Walk me through a maintenance request from intake to handoff.” The same sidebar reveals the seven-step workflow as it is spoken. The illustration on this slide summarizes three parts. The app also draws custom diagrams and charts on request.</li>
      <li>“Open the Facilities onboarding folder.” Relay opens the actual fixture folder in File Explorer when asked. The Windows agent can also open a new browser tab.</li></ol>`)}
  </section>
  <section id="demo" class="demo" aria-label="Live demo">
    <h2>Live demo</h2>${slideProgress(4)}
    ${notes('Switch to the running Facilities Voice Agent with Alt+Tab. Use the maintenance ticket question, open its citation, then request the narrated intake walkthrough. To show desktop use, ask Relay to open the Facilities onboarding folder. Switch back here to finish.')}
  </section>
  <section id="thanks" class="closing" aria-label="Thank you">
    <div class="cover-assembly" aria-hidden="true"><i></i><i></i><i></i>${brand}</div>
    <div class="closing-copy"><h2>Thank you</h2><p class="team-name">Orange Whisky</p><p class="team-names">${people}</p></div>
    ${slideProgress(5)}
    ${notes('Close with the value of passing on practical knowledge so the next colleague can use it on day one. Invite questions. Live handover interview capture and handbook publishing remain planned work.')}
  </section>`;

const stories = new Map([
  [document.querySelector('#problem'), problemCues],
  [document.querySelector('#solution'), solutionCues],
]);

function updateStory() {
  for (const [slide, cues] of stories) {
    const step = slide.querySelectorAll('.checkpoint.visible').length;
    slide.dataset.step = step;
    slide.querySelector('.cue-text').textContent = cues[step];
    for (const item of slide.querySelectorAll('[data-from]')) {
      item.classList.toggle('revealed', step >= Number(item.dataset.from));
    }
    for (const scene of slide.querySelectorAll('[data-scene]')) {
      const active = Number(scene.dataset.scene) === step;
      scene.classList.toggle('revealed', active);
      scene.setAttribute('aria-hidden', String(!active));
    }
    for (const item of slide.querySelectorAll('.workflow li')) {
      const current = step === Number(item.dataset.from);
      if (current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
  }
}

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
Reveal.initialize({
  width: 1600, height: 900, margin: 0, center: false,
  controls: true, controlsTutorial: false, progress: false, hash: true, fragmentInURL: true,
  transition: reduce ? 'none' : 'fade', transitionSpeed: 'fast',
  backgroundTransition: 'none', autoSlide: 0, autoPlayMedia: false, pdfSeparateFragments: false,
  plugins: window.RevealNotes ? [window.RevealNotes] : [],
}).then(updateStory);
Reveal.on('fragmentshown', updateStory);
Reveal.on('fragmenthidden', updateStory);
Reveal.on('slidechanged', updateStory);
document.querySelector('.slides').addEventListener('click', event => {
  if (!event.target.closest('a, button') && !Reveal.isOverview()) Reveal.next();
});
