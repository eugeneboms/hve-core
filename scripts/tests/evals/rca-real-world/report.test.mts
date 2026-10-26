// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { generateEvidenceReport, scanArtifacts } from "../../../evals/rca-real-world/report.mts";
import { parseReportArguments } from "../../../evals/rca-real-world/report-cli.mts";
import { trialDirectory } from "../../../evals/rca-real-world/conditions.mts";
import { readJson, writeJson } from "../../../evals/rca-real-world/contracts.mts";
import type { EvaluationSummary } from "../../../evals/rca-real-world/runner.mts";

test("report CLI defaults to the current UTC day and preserves explicit date overrides", () => {
  const now = new Date("2026-10-26T23:55:00-07:00");
  assert.deepEqual(parseReportArguments(["--run-id", "fixture"], now), {
    runId: "fixture",
    reviewDate: "2026-10-27",
  });
  assert.deepEqual(parseReportArguments([
    "--run-id", "fixture", "--date", "2026-10-19",
  ], now), { runId: "fixture", reviewDate: "2026-10-19" });
  assert.equal(
    parseReportArguments(["--run-id", "fixture"]).reviewDate,
    new Date().toISOString().slice(0, 10),
  );
  assert.throws(() => parseReportArguments([], now), /Usage:/);
});

async function reportFixture(): Promise<{
  readonly repositoryRoot: string;
  readonly runRoot: string;
}> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "rca-report-repo-"));
  const runRoot = join(repositoryRoot, ".copilot-tracking", "evaluations", "run");
  await mkdir(runRoot, { recursive: true });
  await mkdir(join(repositoryRoot, "evals", "rca-real-world"), { recursive: true });
  await writeFile(
    join(runRoot, "run-manifest.json"),
    JSON.stringify({
      repositoryCommit: "a".repeat(40),
      sourceRevision: "afeacb11bcc94dadfd1c8f483ee4377b2b8b614e",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      contextTier: "default",
      inputFingerprint: "b".repeat(64),
      nodeVersion: "v24.14.0",
      readerBundleIdentity: "hyparquet@1.31.5:fixture",
      packageLockSha256: "c".repeat(64),
    }),
    "utf8",
  );
  await writeFile(
    join(runRoot, "commands.json"),
    JSON.stringify({
      commands: [
        {
          command: "npm run ci:rca-eval -- --run-id fixture --round 1",
          exitCode: 0,
          purpose: "Execute round one",
        },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(runRoot, "evaluation-summary.json"),
    JSON.stringify({
      schemaVersion: "2.0.0",
      mode: "with-skill",
      runId: "fixture",
      sourceRevision: "afeacb11bcc94dadfd1c8f483ee4377b2b8b614e",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      contextTier: "default",
      trialOrder: [],
      trials: [
        {
          caseId: "case-01",
          trial: 1,
          condition: "with-skill",
          integrity: "pass",
          strictGates: {
            noGroundTruthLeak: true,
            noUnauthorizedToolCall: true,
            approvalContract: true,
            approvalClearlySimulated: true,
            statisticalApplicability: true,
            noUnsupportedComplete: true,
            outputContract: true,
            honestEvidenceGaps: true,
          },
          diagnostic: {
            findingStatus: "Complete",
            rootCauseService: "match",
            faultOrMechanism: "match",
            correctCauseTested: true,
          },
          leadingHypothesis: {
            status: "candidate",
            rootCauseService: "match",
            faultOrMechanism: "match",
            safetyWarningPresent: true,
          },
          humanReview: "pending",
        },
      ],
      roundOneCheckpoint: { decision: "continue", reasons: [] },
      limitations: ["Selected cases are not a population estimate."],
    }),
    "utf8",
  );
  const sessionRoot = trialDirectory(runRoot, "case-01", 1, "with-skill");
  await mkdir(sessionRoot, { recursive: true });
  await writeFile(
    join(sessionRoot, "session-artifact.json"),
    JSON.stringify({ cliCapture: { usageTurn2: { totalPremiumRequestCost: 2 } } }),
    "utf8",
  );
  return { repositoryRoot, runRoot };
}

test("generates sanitized evidence while preserving human-owned checkboxes", async (context) => {
  const fixture = await reportFixture();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  const result = await generateEvidenceReport({
    ...fixture,
    reviewDate: "2026-10-19",
  });
  const committed = await readFile(result.committedReportPath, "utf8");
  const review = await readFile(result.reviewPath, "utf8");
  const prUpdate = await readFile(result.prUpdatePath, "utf8");
  assert.match(committed, /Strict gates passed in 1 of 1 skilled sessions/);
  assert.match(committed, /Set A service \| Set B service \| Set B status/);
  assert.match(committed, /matched in Set A for 1 sessions and in Set B for\s+1 sessions/);
  assert.doesNotMatch(committed, /16\.93 AI credits|all nine/);
  assert.match(committed, /Single-condition run: no paired skill-lift estimate/);
  assert.match(committed, /- \[ \] Reviewed and validated/);
  assert.doesNotMatch(committed, /- \[x\]/i);
  assert.match(review, /Human disposition \| Reviewer rationale/);
  assert.match(prUpdate, /Please reassess CR-16/);
});

test("reports condition costs and matched correctness differences without mixing workflow gates", async (context) => {
  const fixture = await reportFixture();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  const summaryPath = join(fixture.runRoot, "evaluation-summary.json");
  const summary = await readJson<EvaluationSummary>(summaryPath);
  const skilled = summary.trials[0]!;
  const baseline = {
    ...skilled,
    condition: "without-skill" as const,
    diagnostic: { ...skilled.diagnostic, rootCauseService: "miss" as const },
    strictGates: {
      ...skilled.strictGates,
      statisticalApplicability: "not-applicable" as const,
      noUnsupportedComplete: "not-applicable" as const,
      honestEvidenceGaps: "not-applicable" as const,
    },
  };
  await writeJson(summaryPath, { ...summary, mode: "both", trials: [skilled, baseline] });
  const baselineRoot = trialDirectory(fixture.runRoot, "case-01", 1, "without-skill");
  await mkdir(baselineRoot, { recursive: true });
  await writeJson(join(baselineRoot, "session-artifact.json"), {
    cliCapture: { usageTurn4: { totalPremiumRequestCost: 3 } },
  });
  const result = await generateEvidenceReport({ ...fixture, reviewDate: "2026-10-26" });
  const report = await readFile(result.committedReportPath, "utf8");
  assert.match(report, /\| with-skill \| 1 \| 0 \| 1 \| 1 \| 2 \|/);
  assert.match(report, /\| without-skill \| 1 \| 0 \| 0 \| 1 \| 3 \|/);
  assert.match(report, /\| Set A service \| 1 \| 1 \| 0 \| 100\.0 \|/);
  assert.match(report, /\| Set B service \| 1 \| 0 \| 0 \| 0\.0 \|/);
  assert.match(report, /Authoritative run premium requests \| 5/);
  assert.match(report, /pass; skill workflow N\/A/);

  await writeJson(summaryPath, {
    ...summary, mode: "both", trials: [skilled, { ...baseline, integrity: "fail" }],
  });
  await generateEvidenceReport({ ...fixture, reviewDate: "2026-10-26" });
  const invalid = await readFile(result.committedReportPath, "utf8");
  assert.match(invalid, /Excluded incomplete or invalid pairs: 1/);
  assert.match(invalid, /\| Set A service \| 0 \| 0 \| 0 \| Unavailable \|/);
});

test("reports missing usage as unavailable rather than a zero-cost run", async (context) => {
  const fixture = await reportFixture();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  await writeJson(
    join(trialDirectory(fixture.runRoot, "case-01", 1, "with-skill"), "session-artifact.json"),
    { cliCapture: {} },
  );
  const result = await generateEvidenceReport({ ...fixture, reviewDate: "2026-10-26" });
  assert.match(await readFile(result.committedReportPath, "utf8"), /Authoritative run premium requests \| Unavailable/);
});

test("rejects historical summaries explicitly instead of treating them as paired evidence", async (context) => {
  const fixture = await reportFixture();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  await writeJson(join(fixture.runRoot, "evaluation-summary.json"), { schemaVersion: "1.0.0" });
  await assert.rejects(
    generateEvidenceReport({ ...fixture, reviewDate: "2026-10-26" }),
    /requires condition-aware schema 2\.0\.0/,
  );
});

test("fails publication when traces contain secrets or host paths", async (context) => {
  const fixture = await reportFixture();
  context.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  await writeFile(
    join(fixture.runRoot, "unsafe.json"),
    '{"token":"github_pat_abcdefghijklmnopqrstuvwxyz","path":"C:\\\\Users\\\\person\\\\secret"}',
    "utf8",
  );
  const findings = await scanArtifacts(fixture.runRoot);
  assert.ok(findings.some((item) => item.category === "credential"));
  assert.ok(findings.some((item) => item.category === "windows-home-path"));
  await assert.rejects(
    generateEvidenceReport({ ...fixture, reviewDate: "2026-10-19" }),
    /Artifact scan failed/,
  );
});
