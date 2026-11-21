---
name: excalidraw-design
description: Design or review readable Excalidraw workflows, timelines, team swimlanes, and hierarchies for the SCFH voice app and standalone onboarding demo.
---

Choose the layout that makes the relationship clear. Use a flowchart for decisions, a timeline for milestones, a swimlane for team handoffs, and a hierarchy for branches from a parent. Give each node a short label and put detail in the narration or caption. Label branch outcomes with the terms people use to make the decision.

Use the shared layout in `packages/onboarding/browser/scene-layout.mjs`. Keep the main path predictable, place exceptions to the side, and route connectors through gutters. Keep fills muted and use node types and labels to communicate meaning alongside color. Preserve stable node IDs and reveal a connector only when both ends are visible.

Keep the approved `get_onboarding_walkthrough` facts and narration intact. The Windows voice canvas uses Rough.js with the shared layout. Use `draw_workflow` for structured diagrams and `draw_canvas` for charts or diagrams with camera and object movement. Review both the first reveal and the completed canvas. Confirm that long labels fit, branch arrows avoid cards, and the exported PNG includes content outside the viewport.
