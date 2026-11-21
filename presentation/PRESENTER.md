# Relay presenter guide

Open [relay.html](relay.html) in Chrome or Edge, or double-click `present.cmd`. Press **F** for fullscreen. Use **Right Arrow** or click the slide to advance one beat. **Left Arrow** takes you back.

For Reveal.js speaker view, run `python -m http.server 8765 --bind 127.0.0.1 --directory presentation` from the repo root, open `http://127.0.0.1:8765/relay.html`, then press **S**. The cues below also work as a separate presenter sheet. [Reveal.js speaker view](https://revealjs.com/speaker-view/)

## Six-slide run of show

| Slide | What to say |
| --- | --- |
| Relay | “We’re Aditya Ladawa and Darshan Shah, Team Orange Whisky. Relay helps a new colleague pick up where the last one left off.” |
| Problem · 4 clicks | Show the Facilities Service Desk. Reveal the experienced colleague and their know-how, their departure, the new colleague joining, and the question they face on their first maintenance request. |
| Facts | “In June 2024, 1.42 million people in Germany’s public service were aged 55 or older.” |
| Solution · 5 clicks | Start with approved guides. Reveal the new colleague’s spoken question, the answer, the highlighted source, the narrated walkthrough and the request to open the onboarding folder. |
| Live demo | Switch to the running Facilities Voice Agent. Use the prompts below. |
| Thank you | “The next colleague can start with the same guidance, see where it came from, and follow it through.” |

## Existing app walkthrough

1. “What do I need before I open a maintenance ticket?” Open the answer’s citation and show the highlighted **Intake checklist** passage on PDF page 2.
2. “Walk me through a maintenance request from intake to handoff.” Let the seven steps appear with the narration. The middle slide uses a three-part summary of this same process.
3. “Open the Facilities onboarding folder.” Show the folder opening in Windows File Explorer.

The Windows sidebar also supports cited Word answers, custom diagrams and charts, and desktop navigation on request. The demo uses reviewed sample material. Live handover interviews and handbook publishing are planned work. [Project README](https://github.com/DarshanScripts/scfh-2026/blob/main/README.md) · [Release checks](https://github.com/DarshanScripts/scfh-2026/blob/main/docs/windows-acceptance.md)

## Sources and pacing

- Destatis reports 747,200 public-service staff aged 55–59 and 669,400 aged 60 or older on 30 June 2024. Together they total 1,416,600. The figure measures the age distribution. [Destatis age table](https://www.destatis.de/DE/Themen/Staat/Oeffentlicher-Dienst/Tabellen/beschaeftigen-alter.html) · [Archived 2024 report](https://www.destatis.de/DE/Themen/Staat/Oeffentlicher-Dienst/Publikationen/Downloads-Oeffentlicher-Dienst/statistischer-bericht-personalstand-oeffentlicher-dienst-2140600247005.html)
- Berlin’s Administrative Academy identifies role changes and retirement as causes of lost institutional knowledge. [Berlin guidance](https://www.berlin.de/vak/inhouse/wissenstransfer/)
- The reference deck builds a situation in place and introduces one meaningful change at a time. Relay holds the desk in place on the problem slide and keeps the completed steps visible on the solution slide. Brief movement shows what changed. Each new beat waits for the presenter. [Reveal.js fragments](https://revealjs.com/fragments/)
