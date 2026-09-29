---
title: RCA Skills for Azure SRE Agent
description: Upload and configure the RCA skill package and its companion assessment skills
---

Upload the three skill files from this directory:

* `root-cause-analysis/SKILL.md` owns the investigation and disposition workflow
* `statistical-hypothesis-testing/SKILL.md` compares eligible binary rates or numeric averages
* `causal-evidence-likelihood/SKILL.md` estimates how individual evidence changes hypothesis
   plausibility through a reasoned likelihood ratio

This package contains three skills and does not define a custom agent. Upload all three skills to
Azure SRE Agent so the RCA workflow can invoke its companion assessments.

## Add to SRE Agent

1. Open the agent and go to **Builder > Skills**. Create skills named `root-cause-analysis`,
   `statistical-hypothesis-testing`, and `causal-evidence-likelihood`.
2. Add each corresponding `SKILL.md` as its procedural file using the portal's file controls.
   Use its frontmatter description if the portal asks for one. Add each file as a **skill**, not
   only as a knowledge document.
3. Attach the available read-only tools needed for the incident: Azure resource/configuration
   reads, Log Analytics and ADX queries, and optionally GitHub code/history or issue reads.
   Use the actual tool picker.
4. Verify the agent identity and connector credentials have data access. Uploading a skill
   does not grant permissions. Keep write tools disabled for a read-only investigation.
5. If using a custom agent, select all three skills in **Choose Skills** for that agent.
6. Start a new thread with a specific incident. Check that RCA invokes both companion skills when
   their input contracts apply and that actual tool calls execute. Local Markdown validation does
   not verify upload discovery or native runtime behavior.

Example invocation:

> Use the root-cause-analysis skill to investigate incident ISSUE-123 in service X.
> The failure window is 2026-09-15 12:00-13:00 UTC. Use the preceding comparable hour and
> unaffected instances as controls. Investigate read-only. Form falsifiable competing hypotheses,
> execute discriminating tests using available data, and continue until the completion gate
> passes or you identify a concrete evidence/access blocker. Preserve a resumable checkpoint.

Replace the example incident, service, windows, and controls with real values.

## Behavior and limits

The skill tests predictions before declaring a cause, actively seeks disconfirming evidence,
tracks source duplication and filtering, and preserves exact query parameters and observations.
It invokes statistical testing for eligible grouped observations and causal evidence likelihood
assessment for selected statistically significant pairs whose observed direction supports the
hypothesis. Statistical significance and elicited likelihood ratios inform evidence weighting but
cannot directly set a hypothesis disposition.

`Complete` means the causal completion gate passed. `Provisional`, `Inconclusive`, `Blocked`,
and `Paused` are explicitly not completed RCAs. The skill has no arbitrary iteration quota,
but cannot guarantee that telemetry contains a discoverable root cause or override host budgets.
It cannot autonomously schedule another run.

SRE Agent can unload skills and clears active skills on conversation compaction. The procedure
therefore checkpoints after test cycles and reloads on resume. Use approved incident/thread
storage when available; a checkpoint emitted only in chat is not a guarantee of durable recovery.
Prompt instructions are guidance, not a security boundary: enforce read-only access and approvals
through permissions and host controls.

## Maintain the upload package

Edit and validate each upload skill independently. Do not use the previous byte-for-byte refresh
command from the repository RCA skill because the Azure version includes companion-skill
invocations that the local variant does not currently contain.

Upload every changed skill to update the remote agent; local edits do not update Azure
automatically. Keep portable `name` and `description` frontmatter in each `SKILL.md`.

## Microsoft documentation

* [Skills: creation, tool attachment, and lifecycle](https://learn.microsoft.com/en-us/azure/sre-agent/skills)
* [Connectors and data access](https://learn.microsoft.com/en-us/azure/sre-agent/connectors)
