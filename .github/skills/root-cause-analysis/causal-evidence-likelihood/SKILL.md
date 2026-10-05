---
name: causal-evidence-likelihood
description: 'Assess how one evidence item changes the plausibility of an RCA hypothesis using a reasoned likelihood ratio.'
compatibility: "Requires an Agent Skills host and the root-cause-analysis companion workflow."
---

# Causal Evidence Likelihood

## Goal

Assess whether one observed evidence item makes an RCA hypothesis more or less plausible through
logical and causal reasoning. Return a reasoned likelihood ratio for use by
`root-cause-analysis`, without presenting the estimate as measured probability or causal proof.

## Inputs

* One explicit, falsifiable hypothesis `H`, including its proposed mechanism
* One evidence item `E`, separated into direct observation and interpretation
* Evidence provenance, reliability, coverage, timing, and known transformations
* Plausible alternative explanations and relevant system context

Assess one material evidence-to-hypothesis link at a time. Do not combine multiple observations,
summaries, or duplicated telemetry into one item unless their dependence is explicit.
Do not provide or use p-values, confidence intervals, effect sizes, statistical-test conclusions,
correlation strengths, anomaly scores, sample counts, or likelihood estimates produced by another
skill. If supplied, set them aside before assessment. Use only the meaning of the direct observation
and general knowledge of how the system or class of systems behaves.

## Assessment

Ask:

> Suppose a reasonable observer initially assigns equal probability to `H` and `not H`. After
> learning only `E`, while using established logical and system knowledge, how should the
> observer's assessment of `H` change?

Evaluate this by comparing:

```text
LR(E) = P(E given H) / P(E given not H)
```

With prior odds of 1, the elicited posterior corresponding to the assessment is:

```text
q(E) = LR(E) / (1 + LR(E))
```

Reason in both directions before selecting a value:

1. State why `E` would be expected if `H` were true.
2. State why `E` could occur if `H` were false, including common causes, reverse causation,
   measurement effects, and competing mechanisms.
3. Check whether the proposed cause precedes the effect and whether the mechanism could operate
   in the observed scope.
4. Distinguish direct runtime, control, reproduction, or intervention evidence from source-code
   intent, documentation, temporal proximity, and unexplained correlation.
5. Test logical compatibility explicitly. If `E` cannot be true when `H` is true under the stated
   mechanism and scope, classify it as contradicting even when statistical observations favor
  `H`.
6. Select the narrowest defensible likelihood-ratio band. Prefer `Neutral` when the connection is
  unknown or equally expected under `H` and `not H`.

## Likelihood-Ratio Scale

| Assessment           |                  `LR(E)` | Implied `q(E)` from a 50% prior |
|----------------------|-------------------------:|--------------------------------:|
| Strongly contradicts |             at most 1/19 |                      at most 5% |
| Weakly contradicts   | above 1/19 and below 0.8 |          above 5% and below 44% |
| Neutral or unclear   |         0.8 through 1.25 |                 44% through 56% |
| Weakly supports      |  above 1.25 and below 19 |         above 56% and below 95% |
| Strongly supports    |              at least 19 |                    at least 95% |

Return a band and, when the reasoning supports it, one representative `LR(E)` value. Use the Strong
bands only when general system reasoning makes `E` nearly entailed by `H` or nearly incompatible
with it after considering the strongest plausible alternative. If provenance or meaning is too
uncertain to reason from `E`, return `Not Assessed` rather than `Neutral`.

## Interpretation Constraints

* Label `LR(E)` and `q(E)` as elicited reasoning estimates, not empirical frequencies.
* Do not use `q(E)` as the RCA hypothesis's actual posterior probability. The 50% prior is a
  standard reference point for evidence relevance.
* Do not infer support from evidence reliability alone. Reliability controls whether the
  observation can be trusted; `LR(E)` controls whether it distinguishes `H` from `not H`.
* Do not inspect, cite, summarize, transform, or reproduce statistical inference from this or any
  other skill. Statistical support has already been assessed elsewhere; using it here would count
  the same support twice.
* Derive the direction and ratio only from logical compatibility, mechanism behavior, temporal
  possibility, system constraints, and plausible alternatives. Association strength and causal
  relevance are separate.
* Preserve logical contradiction. Reliable evidence that is incompatible with a necessary part of
  `H` contradicts `H` even if numerous correlations or statistical tests favor it.
* Do not multiply likelihood ratios unless the RCA workflow has justified conditional
  independence or modeled the dependence. Duplicates and downstream consequences of the same
  event do not provide independent updates.
* A code comment or design document can support mechanism plausibility, but it does not prove that
  the path executed during the incident.
* Missing expected evidence contradicts `H` only when source coverage is adequate and `H` predicts
  that the evidence would be emitted, retained, and observed.

## RCA Record

Return:

* Hypothesis ID and exact statement
* Evidence ID, direct observation, provenance, and reliability
* `P(E given H)` rationale
* `P(E given not H)` rationale and strongest plausible alternative
* Direction: supports, contradicts, neutral, or `Not Assessed`
* Likelihood-ratio band and representative `LR(E)` value when defensible
* Implied `q(E)` from the standardized 50% prior, labeled as an elicited relevance estimate
* Reasoning confidence: Low, Medium, or High, with the decisive limitation
* Dependence notes identifying evidence that must not be multiplied with this result
* Next observation that would most change or calibrate the assessment

Return the assessment to `root-cause-analysis`. It informs evidence weighting but cannot directly
set a hypothesis disposition or satisfy the root-cause completion gate.
