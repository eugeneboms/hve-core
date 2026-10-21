// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSchedule,
  resolveInside,
  stableJson,
  validateContract,
  type EvaluationContract,
} from "../../../evals/rca-real-world/contracts.mts";

function validContract(): EvaluationContract {
  const file = (name: string) => ({
    name,
    objectId: "a".repeat(40),
    sha256: "b".repeat(64),
    size: 1,
  });
  return {
    schemaVersion: "1.0.0",
    source: {
      dataset: "phamquiluan/RCAEval",
      revision: "c".repeat(40),
      license: "MIT",
      sourceUrl: "https://example.invalid",
      licenseCard: { path: "README.md", objectId: "d".repeat(40) },
      caseIndex: { path: "cases.parquet", sha256: "e".repeat(64), size: 1 },
    },
    cases: [
      {
        neutralId: "case-01",
        sourcePath: "source-case-one",
        trialOrder: 1,
        modalities: ["metrics"],
        files: [file("inject_time.txt"), file("metrics.parquet")],
      },
      {
        neutralId: "case-02",
        sourcePath: "source-case-two",
        trialOrder: 2,
        modalities: ["metrics", "logs", "traces"],
        files: [
          file("inject_time.txt"),
          file("metrics.parquet"),
          file("logs.parquet"),
          file("traces.parquet"),
        ],
      },
      {
        neutralId: "case-03",
        sourcePath: "source-case-three",
        trialOrder: 3,
        modalities: ["metrics", "logs", "traces"],
        files: [
          file("inject_time.txt"),
          file("metrics.parquet"),
          file("logs.parquet"),
          file("traces.parquet"),
        ],
      },
      {
        neutralId: "case-04",
        sourcePath: "source-case-four",
        trialOrder: 4,
        modalities: ["metrics", "logs"],
        files: [
          file("inject_time.txt"),
          file("metrics.parquet"),
          file("logs.parquet"),
        ],
      },
      {
        neutralId: "case-05",
        sourcePath: "source-case-five",
        trialOrder: 5,
        modalities: ["metrics", "logs", "traces"],
        files: [
          file("inject_time.txt"),
          file("metrics.parquet"),
          file("logs.parquet"),
          file("traces.parquet"),
        ],
      },
    ],
  };
}

test("validates the exact neutral case order", () => {
  assert.deepEqual(
    validateContract(validContract()).map((item) => item.neutralId),
    ["case-01", "case-02", "case-03", "case-04", "case-05"],
  );

  const invalid = validContract();
  const reversed = { ...invalid, cases: [...invalid.cases].reverse() };
  assert.deepEqual(
    validateContract(reversed).map((item) => item.neutralId),
    ["case-01", "case-02", "case-03", "case-04", "case-05"],
  );
});

test("rejects malformed source identities and modality drift", () => {
  const contract = validContract();
  const first = contract.cases[0];
  assert.ok(first);
  assert.throws(
    () =>
      validateContract({
        ...contract,
        cases: [
          {
            ...first,
            files: [{ ...first.files[0]!, sha256: "weak" }, ...first.files.slice(1)],
          },
          ...contract.cases.slice(1),
        ],
      }),
    /Invalid source identity/,
  );
  assert.throws(
    () =>
      validateContract({
        ...contract,
        cases: [
          { ...first, modalities: ["metrics", "logs"] },
          ...contract.cases.slice(1),
        ],
      }),
    /file set does not match/,
  );
});

test("creates the approved round-robin schedule", () => {
  assert.deepEqual(createSchedule(3), [
    { caseId: "case-01", trial: 1 },
    { caseId: "case-02", trial: 1 },
    { caseId: "case-03", trial: 1 },
    { caseId: "case-04", trial: 1 },
    { caseId: "case-05", trial: 1 },
    { caseId: "case-01", trial: 2 },
    { caseId: "case-02", trial: 2 },
    { caseId: "case-03", trial: 2 },
    { caseId: "case-04", trial: 2 },
    { caseId: "case-05", trial: 2 },
    { caseId: "case-01", trial: 3 },
    { caseId: "case-02", trial: 3 },
    { caseId: "case-03", trial: 3 },
    { caseId: "case-04", trial: 3 },
    { caseId: "case-05", trial: 3 },
  ]);
});

test("rejects output-root escape", () => {
  assert.throws(() => resolveInside("C:\\safe", "..\\outside"), /allowed root/);
  assert.throws(() => resolveInside("C:\\safe", "."), /allowed root/);
});

test("serializes equivalent objects deterministically", () => {
  assert.equal(stableJson({ b: 2, a: { d: 4, c: 3 } }), stableJson({ a: { c: 3, d: 4 }, b: 2 }));
});
