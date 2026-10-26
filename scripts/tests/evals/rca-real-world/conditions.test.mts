// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { baselineOutputContract, createConditionSchedule, parseEvaluationMode } from "../../../evals/rca-real-world/conditions.mts";
import { parseRunArguments, selectEvaluationMode } from "../../../evals/rca-real-world/run-cli.mts";

test("schedules thirty unique paired sessions and alternates condition order", () => {
  const schedule = createConditionSchedule(3, "both");
  assert.equal(schedule.length, 30);
  assert.equal(new Set(schedule.map((item) => `${item.condition}/${item.caseId}/${item.trial}`)).size, 30);
  assert.equal(schedule[0]?.condition, "with-skill");
  assert.equal(schedule[2]?.condition, "without-skill");
  assert.equal(schedule[10]?.condition, "without-skill");
  assert.equal(createConditionSchedule(3, "with-skill").length, 15);
  assert.equal(createConditionSchedule(3, "without-skill").length, 15);
});

test("validates explicit CLI condition selection without side effects", () => {
  assert.equal(parseRunArguments(["--run-id", "fixture", "--round", "1"]).mode, undefined);
  assert.equal(parseRunArguments([
    "--run-id", "fixture", "--round", "1", "--conditions", "without-skill", "--interactive",
  ]).mode, "without-skill");
  assert.throws(() => parseEvaluationMode("invalid"), /Conditions must be/);
  assert.throws(() => parseRunArguments(["--run-id", "fixture", "--round", "4"]), /Usage:/);
  assert.throws(() => parseRunArguments(["--run-id", "fixture", "--round", "01"]), /Usage:/);
  assert.throws(() => parseRunArguments([
    "--run-id", "fixture", "--round", "1", "--conditions", "invalid",
  ]), /Conditions must be/);
});

test("defaults to both noninteractively and prompts only at interactive initialization", async () => {
  const noPrompt = async (): Promise<string> => { throw new Error("Must not prompt"); };
  assert.equal(await selectEvaluationMode({
    round: 1, interactive: false, ask: noPrompt,
  }), "both");
  assert.equal(await selectEvaluationMode({
    round: 2, interactive: true, ask: noPrompt,
  }), undefined);
  assert.equal(await selectEvaluationMode({
    round: 1, interactive: true, mode: "with-skill", ask: noPrompt,
  }), "with-skill");
  for (const answer of ["", "both", "with-skill", "without-skill"]) {
    let prompts = 0;
    assert.equal(await selectEvaluationMode({
      round: 1, interactive: true,
      ask: async (question) => {
        prompts += 1;
        assert.match(question, /both.*with-skill only.*without-skill only/);
        return answer;
      },
    }), answer || "both");
    assert.equal(prompts, 1);
  }
  await assert.rejects(selectEvaluationMode({
    round: 1, interactive: true, ask: async () => "invalid",
  }), /Conditions must be/);
});

test("baseline format contains no skill workflow or companion instructions", () => {
  const prompt = baselineOutputContract();
  assert.match(prompt, /Root-cause target/);
  assert.match(prompt, /Candidate target/);
  assert.doesNotMatch(prompt, /root-cause-analysis|causal-evidence-likelihood|statistical-hypothesis-testing|eight|completion gate|H-001|T-001/i);
});
