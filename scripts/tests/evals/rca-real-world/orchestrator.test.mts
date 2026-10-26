// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { runCliTrial } from "../../../evals/rca-real-world/cli-orchestrator.mts";
import {
  EVALUATION_RUN_DIRECTORY, sha256, stableJson,
} from "../../../evals/rca-real-world/contracts.mts";
import {
  runTrial,
  type ModelClient,
  type SessionCreationConfig,
} from "../../../evals/rca-real-world/orchestrator.mts";
import { sanitizeRun } from "../../../evals/rca-real-world/sanitize-run.mts";

const NOW = new Date("2026-10-19T20:00:00.000Z");

async function runRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rca-orchestrator-"));
  const caseRoot = join(root, "inputs", "model-visible", "case-01");
  await mkdir(caseRoot, { recursive: true });
  await writeFile(join(caseRoot, "metric-columns.json"), "{}\n", "utf8");
  await writeFile(
    join(caseRoot, "incident.json"),
    '{"caseId":"case-01","incidentOnset":"1700000000"}',
    "utf8",
  );
  await writeFile(
    join(caseRoot, "source-coverage.json"),
    '{"sources":[{"modality":"metrics","rowCount":1}]}',
    "utf8",
  );
  await writeFile(
    join(caseRoot, "metrics.jsonl"),
    '{"timestamp":1700000000,"service":"adservice","metric":"cpu","value":95}\n',
    "utf8",
  );
  return root;
}

function approvalResponse(): string {
  return [
    "Generic mode. Requesting exact bounded evidence.",
    "```json",
    JSON.stringify({
      approvalRequests: [
        {
          tool: "read_incident_scope",
          operation: "read",
          parameters: {},
          evidenceSought: "Incident scope and source coverage",
          target: "case-01",
          scope: "current neutral case only",
          maximumCallCount: 1,
          expectedRisk: "read-only bounded fixture evidence",
          expiresAt: "2026-10-19T20:10:00.000Z",
        },
      ],
    }),
    "```",
  ].join("\n");
}

function finalResponse(): string {
  return [
    "### 1. Status and Finding",
    "Provisional: adservice CPU saturation is the leading explanation. Human sign-off unavailable.",
    "### 2. Source Coverage",
    "| Source | Coverage | Gaps |",
    "|---|---|---|",
    "| S-001 | Metrics | Logs and traces unavailable |",
    "### 3. Hypotheses Tested",
    "H-001 CPU saturation; N/A - dependent time points.",
    "### 4. Executed Tests and Evidence",
    "T-001 executed through Approval fixture.",
    "### 5. Causal Account and Gate",
    "Completion gate not met because accountable human sign-off is unavailable.",
    "### 6. Actions and Open Decisions",
    "Human review remains open.",
    "### 7. Authorization and Execution Audit",
    "Simulated fixture approval only; no production authorization.",
    "### 8. Resume Checkpoint",
    "Review source metrics and obtain accountable sign-off.",
  ].join("\n\n");
}

test("uses the exact model profile and independently approved tool path", async () => {
  const root = await runRoot();
  let capturedConfig: SessionCreationConfig | undefined;
  let sendCount = 0;
  const clientFactory = async (): Promise<ModelClient> => ({
    start: async () => undefined,
    stop: async () => undefined,
    listModels: async () => [
      { id: "gpt-5.6-sol", supportedReasoningEfforts: ["low", "medium", "high"] },
    ],
    getStatus: async () => ({ version: "fake", path: resolve(".") }),
    createSession: async (config) => {
      capturedConfig = config;
      return {
        onEvent: (handler) => {
          handler({ type: "session.start", credential: "github_pat_abcdefghijklmnopqrstuvwxyz" });
          handler({ type: "workspace", path: config.workingDirectory });
          return () => undefined;
        },
        sendAndWait: async () => {
          sendCount += 1;
          if (sendCount === 1) {
            return { content: approvalResponse() };
          }
          const tool = config.tools.find((candidate) => candidate.name === "read_incident_scope");
          await tool!.handler({});
          return { content: finalResponse() };
        },
        destroy: async () => undefined,
      };
    },
  });

  const artifact = await runTrial({
    repositoryRoot: resolve("."),
    runRoot: root,
    runId: "fixture-run",
    caseId: "case-01",
    trial: 1,
    clientFactory,
    clock: () => NOW,
  });

  assert.equal(capturedConfig?.model, "gpt-5.6-sol");
  assert.equal(capturedConfig?.reasoningEffort, "medium");
  assert.equal(capturedConfig?.contextTier, "default");
  assert.equal(sendCount, 2);
  assert.equal(artifact.endReason, "complete");
  assert.equal(artifact.evidenceToolTraces.length, 1);
  assert.equal(
    (artifact.approvalLedger as { establishesProductionAuthorization: boolean })
      .establishesProductionAuthorization,
    false,
  );
  assert.doesNotMatch(JSON.stringify(artifact), /github_pat_|HVE-SRE-skill/i);
  assert.ok(capturedConfig);
  assert.equal(JSON.stringify(artifact).includes(capturedConfig.workingDirectory), false);
  const persisted = await readFile(
    join(root, "sessions", "case-01", "trial-1", "session-artifact.json"),
    "utf8",
  );
  assert.equal(persisted.includes(JSON.stringify(capturedConfig.workingDirectory).slice(1, -1)), false);
  assert.ok(artifact.redactionManifest.replacements >= 1);
});

test("redacts CLI workspace paths in persisted errors and keeps hashes consistent", async (context) => {
  const root = await runRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  let workspace: string | undefined;
  const artifact = await runCliTrial({
    repositoryRoot: resolve("."),
    runRoot: root,
    runId: "cli-redaction",
    caseId: "case-01",
    trial: 1,
    cliInvoker: async (_args, options) => {
      workspace = options.cwd;
      throw new Error(`CLI failure in ${options.cwd}`);
    },
    clock: () => NOW,
  });
  assert.ok(workspace);
  assert.equal(artifact.endReason, "error");
  assert.equal(artifact.error, "CLI failure in [REDACTED_PATH]");
  const sessionRoot = join(root, "sessions", "case-01", "trial-1");
  const persisted = await readFile(join(sessionRoot, "session-artifact.json"), "utf8");
  assert.equal(persisted.includes(JSON.stringify(workspace).slice(1, -1)), false);
  const hashes = JSON.parse(await readFile(join(sessionRoot, "artifact-hashes.json"), "utf8"));
  assert.equal(hashes.sessionArtifactSha256, sha256(stableJson(artifact)));
  assert.ok(artifact.redactionManifest.applied.includes("temporary-workspace"));
});

test("sanitizes persisted home paths and refreshes scores and checkpoint hashes", async (context) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "rca-sanitize-"));
  context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const runId = "sanitize-fixture";
  const root = join(repositoryRoot, ".copilot-tracking", "evaluations", EVALUATION_RUN_DIRECTORY, runId);
  await mkdir(root, { recursive: true });
  const artifact = await runTrial({
    repositoryRoot: resolve("."),
    runRoot: root,
    runId,
    caseId: "case-01",
    trial: 1,
    clientFactory: async () => { throw new Error("Fixture model unavailable"); },
    clock: () => NOW,
  });
  const sessionRoot = join(root, "sessions", "case-01", "trial-1");
  await writeFile(join(sessionRoot, "session-artifact.json"), stableJson({
    ...artifact,
    events: [{ path: join(homedir(), "private-output") }],
  }));
  const truthRoot = join(root, "inputs", "scorer-only", "truth");
  await mkdir(truthRoot, { recursive: true });
  await writeFile(join(truthRoot, "case-01.json"), stableJson({
    neutralId: "case-01",
    sourcePath: "held-out-case-01",
    rootCauseService: "adservice",
    fault: "cpu",
    compatibleMechanism: "CPU saturation",
  }));
  await writeFile(join(root, "evaluation-summary.json"), stableJson({ trials: [] }));
  await writeFile(join(root, "round-one-checkpoint.json"), stableJson({
    decision: "pause", trialResultHashes: {},
  }));
  const result = await sanitizeRun(repositoryRoot, runId);
  assert.equal(result.sessions, 1);
  assert.ok(result.replacements >= 1);
  const sanitized = JSON.parse(await readFile(join(sessionRoot, "session-artifact.json"), "utf8"));
  assert.equal(sanitized.events[0].path.startsWith("[REDACTED_PATH]"), true);
  assert.ok(sanitized.redactionManifest.applied.includes("temporary-workspace"));
  const hashes = JSON.parse(await readFile(join(sessionRoot, "artifact-hashes.json"), "utf8"));
  assert.equal(hashes.sessionArtifactSha256, sha256(stableJson(sanitized)));
  const score = JSON.parse(await readFile(join(sessionRoot, "trial-result.json"), "utf8"));
  const summary = JSON.parse(await readFile(join(root, "evaluation-summary.json"), "utf8"));
  const checkpoint = JSON.parse(await readFile(join(root, "round-one-checkpoint.json"), "utf8"));
  assert.equal(score.hashes.sessionArtifactSha256, hashes.sessionArtifactSha256);
  assert.deepEqual(summary.trials, [score]);
  assert.equal(checkpoint.trialResultHashes["case-01"], score.hashes.resultSha256);
});

test("fails closed before sending when the exact model profile is unavailable", async () => {
  const root = await runRoot();
  let sendCount = 0;
  const artifact = await runTrial({
    repositoryRoot: resolve("."),
    runRoot: root,
    runId: "unavailable-profile",
    caseId: "case-01",
    trial: 1,
    clientFactory: async () => ({
      start: async () => undefined,
      stop: async () => undefined,
      listModels: async () => [{ id: "different-model", supportedReasoningEfforts: ["medium"] }],
      getStatus: async () => ({ version: "fake" }),
      createSession: async () => {
        sendCount += 1;
        throw new Error("must not create");
      },
    }),
    clock: () => NOW,
  });
  assert.equal(sendCount, 0);
  assert.equal(artifact.endReason, "error");
  assert.match(artifact.error ?? "", /Exact model profile unavailable/);
});

test("does not retry a failed approved turn", async () => {
  const root = await runRoot();
  let sendCount = 0;
  const artifact = await runTrial({
    repositoryRoot: resolve("."),
    runRoot: root,
    runId: "failed-turn",
    caseId: "case-01",
    trial: 1,
    clientFactory: async () => ({
      start: async () => undefined,
      stop: async () => undefined,
      listModels: async () => [
        { id: "gpt-5.6-sol", supportedReasoningEfforts: ["medium"] },
      ],
      getStatus: async () => ({ version: "fake" }),
      createSession: async () => ({
        onEvent: () => () => undefined,
        sendAndWait: async () => {
          sendCount += 1;
          if (sendCount === 1) {
            return { content: approvalResponse() };
          }
          throw new Error("synthetic model failure");
        },
        destroy: async () => undefined,
      }),
    }),
    clock: () => NOW,
  });
  assert.equal(sendCount, 2);
  assert.equal(artifact.endReason, "error");
  assert.match(artifact.error ?? "", /synthetic model failure/);
});

test("persists trace and hash artifacts", async () => {
  const root = await runRoot();
  await runTrial({
    repositoryRoot: resolve("."),
    runRoot: root,
    runId: "artifact-run",
    caseId: "case-01",
    trial: 1,
    clientFactory: async () => ({
      start: async () => undefined,
      stop: async () => undefined,
      listModels: async () => [
        { id: "gpt-5.6-sol", supportedReasoningEfforts: ["medium"] },
      ],
      getStatus: async () => ({ version: "fake" }),
      createSession: async (config) => {
        let turn = 0;
        return {
          onEvent: () => () => undefined,
          sendAndWait: async () => {
            turn += 1;
            if (turn === 1) {
              return { content: approvalResponse() };
            }
            await config.tools.find((tool) => tool.name === "read_incident_scope")!.handler({});
            return { content: finalResponse() };
          },
          destroy: async () => undefined,
        };
      },
    }),
    clock: () => NOW,
  });
  const sessionRoot = join(root, "sessions", "case-01", "trial-1");
  assert.doesNotReject(() => readFile(join(sessionRoot, "session-artifact.json"), "utf8"));
  assert.doesNotReject(() => readFile(join(sessionRoot, "fixture-approval-ledger.json"), "utf8"));
  assert.doesNotReject(() => readFile(join(sessionRoot, "artifact-hashes.json"), "utf8"));
});
