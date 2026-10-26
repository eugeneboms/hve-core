// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

import { join } from "node:path";

import { createSchedule, EVALUATION_CASE_IDS } from "./contracts.mts";

export type EvaluationCondition = "with-skill" | "without-skill";
export type EvaluationMode = "both" | EvaluationCondition;

export const RCA_SKILL_NAMES = [
  "root-cause-analysis",
  "causal-evidence-likelihood",
  "statistical-hypothesis-testing",
] as const;

/** Rejects unknown selections rather than silently substituting a different experiment. */
export function parseEvaluationMode(value: string): EvaluationMode {
  if (value !== "both" && value !== "with-skill" && value !== "without-skill") {
    throw new Error("Conditions must be both, with-skill, or without-skill");
  }
  return value;
}

/** Expands a validated selection into independently isolated experimental conditions. */
export function selectedConditions(mode: EvaluationMode): readonly EvaluationCondition[] {
  parseEvaluationMode(mode);
  return mode === "both" ? ["with-skill", "without-skill"] : [mode];
}

/** Pairs each case/trial, alternating which condition goes first across cases and rounds. */
export function createConditionSchedule(rounds: number, mode: EvaluationMode): readonly {
  readonly caseId: string;
  readonly trial: number;
  readonly condition: EvaluationCondition;
}[] {
  return createSchedule(rounds).flatMap((item, index) => {
    const conditions = [...selectedConditions(mode)];
    if ((index % EVALUATION_CASE_IDS.length + item.trial) % 2 === 0) {
      conditions.reverse();
    }
    return conditions.map((condition) => ({ ...item, condition }));
  });
}

/** Keeps condition identities separate for artifacts, scores, usage, and checkpoint hashes. */
export function trialDirectory(
  runRoot: string,
  caseId: string,
  trial: number,
  condition: EvaluationCondition,
): string {
  return join(runRoot, "sessions", condition, caseId, `trial-${trial}`);
}

/** Limits the baseline's format instructions to fields needed by the shared correctness scorer. */
export function baselineOutputContract(): string {
  return [
    "Solve the incident using your own analysis, without skills or custom agents.",
    "Start with `### 1. Status and Finding` and these bullet fields:",
    "* Finding status: your assessment of how well the diagnosis is supported",
    "* Root-cause target: the evidence-supported service, or Unassessed",
    "* Fault or mechanism: the evidence-supported mechanism, or Unassessed",
    "* Candidate target: your best weaker service candidate, or No defensible candidate",
    "* Candidate mechanism: its proposed mechanism, or Unassessed",
    "After these fields, explain your evidence, uncertainty, alternatives, and limitations in your own format.",
    "Distinguish a supported diagnosis from a tentative candidate; do not fill missing evidence with guesses.",
    "State that fixture approval is simulated and is not production authorization.",
  ].join("\n");
}
