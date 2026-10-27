---
title: RCAEval real-world RCA evaluation
description: Compare skilled and skill-free RCA on five blinded RCAEval cases with bounded evidence tools
author: HVE Core Team
ms.date: 2026-10-27
ms.topic: reference
keywords:
  - root cause analysis
  - rcaeval
  - evaluation
  - copilot sdk
  - blinded testing
---

This evaluation compares the root-cause-analysis skill with a skill-free baseline on five
controlled RCAEval fault-injection cases. Both conditions run by default, using the same model
profile, cases, evidence-tool contracts, turn limits, timeouts, and credit limits. Workflow
conformance is measured separately from held-out diagnostic results. The selected cases do not
represent organic production incidents or a statistically representative benchmark.

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

Each condition runs in a fresh temporary workspace and independent model session. Only the
`with-skill` condition receives the three packaged RCA skills. The `without-skill` condition
receives no skill bundle, no custom agent, and no RCA reasoning procedure. Both receive one
neutral case context. They cannot access the repository, the case contract, source paths,
other cases, prior model output, or scorer-only files. Genuine service names remain in telemetry
because they are evidence; packaging metadata never identifies one as the expected answer.

The CLI uses a private home and configuration for every session. The host disables hooks and IDE
autoconnection, suppresses custom instruction loading, disables built-in MCP servers, and exposes
no model-callable tools. Evidence calls are instead validated and executed by the host. Inherited
skills can still be discovered from a temporary directory's ancestors: the harness enumerates
them, disables all except the exact staged RCA package in private settings, then verifies the
enabled skill and plugin inventories. The baseline must have zero enabled skills and plugins.
Unsupported inventory commands, malformed responses, or unexpected enabled capabilities fail
closed before inference. No user configuration is changed or copied into the workspace.

This establishes no runtime skill access, not absence of skill-related material in model training.
The skilled bundle is supplied explicitly in the initial prompt; inherited custom instructions
are suppressed for both conditions.

## Prerequisites

* Node.js 24 and dependencies restored with `npm ci`
* Network access to the pinned Hugging Face revision for preparation
* Copilot CLI supporting `skill list --json`, `plugin list --json`, and the enforced isolation flags
* GitHub Copilot authentication available through an environment token or credential provider
  that works with a fresh CLI home; the harness does not copy stored login files
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

PR validation runs `npm run test:rca-eval` in the required `RCA Harness Tests` job on every
workflow run, without path filtering. These deterministic tests use fixtures and simulated
responses with Node's built-in test runner; they require no dependency installation, model
credentials, external dataset download, or inference budget.

The model-backed command is CI-owned because it uses external data, credentials, and model budget.
It is not invoked by PR validation or another workflow. Run it separately only after confirming
the evaluation scope, budget, and trial cadence.
The report command defaults to today's UTC date; use `--date YYYY-MM-DD` to specify another date.

## Condition selection and scoring

Noninteractive execution defaults to both conditions. In a terminal, a new run asks whether to
run both (the default), only `with-skill`, or only `without-skill`. Use `--interactive` to require
terminal selection, or specify `--conditions` to choose explicitly without prompting:

```powershell
npm run ci:rca-eval -- --run-id <run-id> --round 1 --conditions both
npm run ci:rca-eval -- --run-id <run-id> --round 1 --conditions with-skill
npm run ci:rca-eval -- --run-id <run-id> --round 1 --conditions without-skill
```

The selection is recorded in the immutable run manifest. Later rounds reuse it without asking;
an explicit conflicting selection is rejected before any session starts. Condition order
alternates across cases and rounds. Schema version `2.0.0` requires a new run ID; do not resume
or rescore historical single-condition artifacts with the new session layout.

The baseline receives only a neutral correctness-compatible answer format: supported service
and mechanism, a separate weaker candidate service and mechanism, finding status, and free-form
evidence and limitations. Both conditions use the same held-out service and mechanism extraction
for supported diagnoses (Set A) and leading candidates (Set B). The baseline is not required to
produce the skill's eight sections, hypothesis ledger, completion gate, statistical-companion
phrasing, or human-sign-off workflow. Skill-only gates are recorded as `not-applicable`, not
failed or passed; safety, fixture-approval, integrity, and the condition's output-format checks
still apply.

Set B service match is the primary shared diagnostic endpoint: it compares the model's best
candidate without requiring skill completion. Set A also reflects how readily each condition
asserts an evidence-supported diagnosis. The skill's claim-authority gates can constrain that
assertion, so Set A alone is not a like-for-like measure of diagnostic ability. Mechanism scores
remain in each trial result; compatibility and unsupported claims require human adjudication.

Reports separate sessions, failures, outcomes, and costs by condition. Matched comparisons use
the same case and trial, exclude pairs with an incomplete or integrity-failed session, and show
the exclusion count. They report skill-only and baseline-only matches and the observed
percentage-point difference. Unassessed diagnoses and abstentions are not matches. A
single-condition run cannot produce a skill-lift estimate.

The experiment measures incremental value within the existing host-directed, bounded evidence
protocol, not unconstrained autonomous RCA. Both conditions receive the same broad evidence
batches and can choose their focused queries independently; those queries can return different
evidence. No additional evaluation or significance claim follows from five selected cases.
The historical committed evidence predates this paired protocol and is not a baseline comparison.

## Trial cadence and checkpoint

Before starting an evaluation, the coordinating person or agent must ask:

> Would you like to pause after round 1 to review the results and approve continuation, or run
> all three rounds without that review pause?

Record the user's choice in the evaluation run notes before execution. Do not infer permission
to run all three rounds from a missing response.

* If the user chooses a pause, run the selected trial-1 sessions, present their results, and wait for
  explicit approval before starting any trial-2 or trial-3 session.
* If the user chooses all three rounds, run rounds 1, 2, and 3 in order without asking again at
  the round-one review checkpoint, provided the automated continuation checks pass.

Each round contains one isolated trial per case and selected condition. The default paired run
has 10 sessions per round and 30 across all three rounds; selecting one condition gives 5 and 15,
respectively. Pairing therefore doubles the scheduled model sessions and budget exposure.

```text
round 1: case-01 trial 1 in both conditions, then case-02 through case-05 in both
automated checkpoint; human review and approval only if the user chose a pause
round 2: case-01 through case-05, trial 2 in both conditions
round 3: case-01 through case-05, trial 3 in both conditions
```

The CLI executes one round per invocation using `--round 1`, `--round 2`, or `--round 3`.
The coordinating person or agent owns the upfront question, choice recording, and any requested
review pause; the CLI does not prompt for or enforce that human approval. Invoke the later
rounds only when the selected cadence permits them.

The checkpoint's automatically computed `decision` reports whether machine checks permit
continuation, not whether a human reviewed or approved the results. A `pause` decision blocks
later rounds for both conditions in either cadence. A `continue` decision does not replace human approval when the
user requested the review pause. A failed session remains a result and is never retried
automatically. Diagnostic compatibility, unsupported claims, and final CR-16 assessment still
require human review even when all three rounds were authorized upfront.

## Evidence

Raw inputs, transcripts, tool traces, approvals, scores, and manifests are written below:

```text
.copilot-tracking/evaluations/rcaeval-three-case/<run-id>/
  sessions/with-skill/<case-id>/trial-<n>/
  sessions/without-skill/<case-id>/trial-<n>/
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
* Repeated time points from one injected incident are dependent observations. In the skilled
  condition, the statistical companion must report the independent-unit test as not applicable
  or blocked rather than inventing a p-value. Baseline unsupported statistical claims remain
  subject to human review, not a skill-specific wording test.
* Diagnostic compatibility, unsupported claims, CR-16 satisfaction, and issue closure remain
  human decisions.

🤖 Crafted with precision by ✨Copilot following brilliant human instruction, then carefully refined by our team of discerning human reviewers.
