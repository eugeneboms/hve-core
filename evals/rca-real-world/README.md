---
title: RCAEval real-world RCA evaluation
description: Run five blinded RCAEval cases through the root-cause-analysis skill with bounded evidence tools
author: HVE Core Team
ms.date: 2026-10-26
ms.topic: reference
keywords:
  - root cause analysis
  - rcaeval
  - evaluation
  - copilot sdk
  - blinded testing
---

This evaluation exercises the root-cause-analysis skill against five controlled RCAEval
fault-injection cases. It measures workflow conformance separately from held-out diagnostic
results. The selected cases do not represent organic production incidents or a statistically
representative benchmark.

## Field investigations versus evaluation trials

In field use, the [root-cause-analysis skill](../../.github/skills/root-cause-analysis/root-cause-analysis/SKILL.md)
conducts one investigation, not three benchmark rounds. Continue hypothesis testing and evidence
collection automatically whenever the skill's host-mode rules, security policy, authorization,
declared scope, and execution budget permit it without another approval. Ask only when an
applicable approval gate or missing user decision requires it. This does not remove the skill's
generic-mode approval requirements or expand Azure SRE automatic collection authority.

An investigation may contain multiple test cycles and may resume from a checkpoint. These are
progress within an investigation, not repeated evaluation trials.

The three-round schedule below is for baseline measurement and regression evaluation before
publication or after a substantial skill update. It does not prescribe field investigation
cadence. Choosing to run all three evaluation rounds never overrides security or tool approvals.

## Source and license

The preparation command retrieves selected files from
[`phamquiluan/RCAEval`](https://huggingface.co/datasets/phamquiluan/RCAEval) at revision
`afeacb11bcc94dadfd1c8f483ee4377b2b8b614e`. That dataset revision is published under the MIT
license.

No RCAEval telemetry or transformed telemetry is committed to this repository. The committed
case contract records source paths only for preparation and provenance. Generated data remains
under the gitignored evaluation evidence root.

## Metric identities

Preparation preserves source column names and writes a per-case `metric-columns.json` mapping
each wide numeric column to its service and metric identities. The pinned RCAEval schema uses
terminal metric suffixes: `cpu`, `mem`, `latency`, `latency-50`, `latency-90`, `load`, `error`,
`diskio`, `socket`, and `workload`. Preparation extracts only these declared suffixes, preserving
underscores inside service names, and rejects unknown numeric columns instead of guessing a
boundary. The mapping uses telemetry schema only, never held-out root-cause labels.

`read_incident_scope` exposes the mapping. Both metric tools compare requested identities using
trimmed, case-insensitive equality, not substring matching. For example, `latency` does not match
`latency-90`, and `user` does not match `user-db`. Narrow rows use their explicit identity fields;
rows missing a requested identity are excluded. Mixed narrow and wide rows are handled per row.
Matched-row counts include only rows contributing selected finite numeric values.

The preparation manifest hashes each mapping, and continuation fingerprints include the mapping
files. Transformation version `2.0.0` requires freshly prepared inputs; old runs must not be resumed
with the new filtering semantics. Unknown, missing, or malformed mappings fail explicitly.

## Blindness boundary

The preparation command creates two separate roots:

* `model-visible/` contains neutrally named incident metadata and deterministic evidence stores.
* `scorer-only/` contains source provenance, hashes, and held-out service and fault labels.

Model sessions run from isolated temporary workspaces that receive the packaged RCA skills and
one neutral case context. They cannot access the repository, the case contract, source paths,
other cases, prior model output, or scorer-only files. Genuine service names remain in telemetry
because they are evidence; packaging metadata never identifies one as the expected answer.

## Prerequisites

* Node.js 24 and dependencies restored with `npm ci`
* Network access to the pinned Hugging Face revision for preparation
* GitHub Copilot authentication available to the Copilot SDK and CLI
* Exact `gpt-5.6-sol` model identity with `medium` reasoning effort and the `default` context tier
* A human reviewer for diagnostic compatibility and final CR-16 assessment

The harness fails closed before model execution if the exact model profile is unavailable,
source provenance changes, an input is malformed, or a blindness check fails.

## Commands

```powershell
npm run rca-eval:prepare -- --run-id <run-id>
npm run test:rca-eval
npm run ci:rca-eval -- --run-id <run-id> --round 1
```

The model-backed command is CI-owned because it uses external data, credentials, and model budget.
The report command defaults to today's UTC date; use `--date YYYY-MM-DD` to specify another date.

## Trial cadence and checkpoint

Before starting an evaluation, the coordinating person or agent must ask:

> Would you like to pause after round 1 to review the results and approve continuation, or run
> all three rounds without that review pause?

Record the user's choice in the evaluation run notes before execution. Do not infer permission
to run all three rounds from a missing response.

* If the user chooses a pause, run the five trial-1 sessions, present their results, and wait for
  explicit approval before starting any trial-2 or trial-3 session.
* If the user chooses all three rounds, run rounds 1, 2, and 3 in order without asking again at
  the round-one review checkpoint, provided the automated continuation checks pass.

Each round contains one isolated trial per case:

```text
round 1: case-01 trial 1, case-02 trial 1, case-03 trial 1, case-04 trial 1, case-05 trial 1
automated checkpoint; human review and approval only if the user chose a pause
round 2: case-01 trial 2, case-02 trial 2, case-03 trial 2, case-04 trial 2, case-05 trial 2
round 3: case-01 trial 3, case-02 trial 3, case-03 trial 3, case-04 trial 3, case-05 trial 3
```

The CLI executes one round per invocation using `--round 1`, `--round 2`, or `--round 3`.
The coordinating person or agent owns the upfront question, choice recording, and any requested
review pause; the CLI does not prompt for or enforce that human approval. Invoke the later
rounds only when the selected cadence permits them.

The checkpoint's automatically computed `decision` reports whether machine checks permit
continuation, not whether a human reviewed or approved the results. A `pause` decision blocks
later rounds in either cadence. A `continue` decision does not replace human approval when the
user requested the review pause. A failed session remains a result and is never retried
automatically. Diagnostic compatibility, unsupported claims, and final CR-16 assessment still
require human review even when all three rounds were authorized upfront.

## Evidence

Raw inputs, transcripts, tool traces, approvals, scores, and manifests are written below:

```text
.copilot-tracking/evaluations/rcaeval-three-case/<run-id>/
```

The committed `PR-3136-EVIDENCE.md` report contains only sanitized outcomes, immutable input and
artifact hashes, commands, limitations, and human-review status. It excludes raw telemetry,
credentials, host paths, personal data, and unredacted tool payloads.

Both trial runners and the retrospective sanitizer use the shared
[`redaction.mts`](../../scripts/evals/rca-real-world/redaction.mts) helper for session artifacts.
It collects the OS home directory, `HOME`, and `USERPROFILE`; the runners also supply the repository
root and exact temporary workspace. Redaction handles slash variants and JSON-escaped paths,
replaces longer paths before their parents, and retains home-pattern and credential fallbacks.
The sanitizer cannot infer a past temporary workspace or a different host's custom home directory;
those historical artifacts still need review before sharing.

## Interpretation limits

* Five selected cases and their model sessions do not establish a general RCA accuracy rate.
* RCAEval uses controlled fault injection on microservice testbeds.
* Fixture approvals test generic-mode approval-protocol behavior. They do not establish live
  production authorization or authenticated human approval.
* Repeated time points from one injected incident are dependent observations. The statistical
  companion must report the independent-unit test as not applicable or blocked rather than
  inventing a p-value.
* Diagnostic compatibility, unsupported claims, CR-16 satisfaction, and issue closure remain
  human decisions.

🤖 Crafted with precision by ✨Copilot following brilliant human instruction, then carefully refined by our team of discerning human reviewers.
