// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  FixtureApprovalLedger,
  type ApprovalRequestItem,
} from "../../../evals/rca-real-world/approval.mts";
import { createEvidenceTools } from "../../../evals/rca-real-world/evidence-tools.mts";

const NOW = "2026-10-19T20:00:00.000Z";

function approval(
  tool: string,
  operation: string,
  parameters: Readonly<Record<string, unknown>>,
): ApprovalRequestItem {
  return {
    tool,
    operation,
    parameters,
    evidenceSought: "Bounded test evidence",
    target: "case-01",
    scope: "Current neutral case only",
    maximumCallCount: 1,
    expectedRisk: "Read-only fixture evidence",
    expiresAt: "2026-10-19T20:10:00.000Z",
  };
}

async function caseRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rca-tools-"));
  await writeFile(
    join(root, "incident.json"),
    '{"caseId":"case-01","incidentOnset":"1700000000"}',
    "utf8",
  );
  await writeFile(
    join(root, "source-coverage.json"),
    '{"sources":[{"modality":"metrics","rowCount":2}]}',
    "utf8",
  );
  await writeFile(
    join(root, "metrics.jsonl"),
    [
      '{"timestamp":1,"service":"checkoutservice","metric":"latency","value":10}',
      '{"timestamp":2,"service":"checkoutservice","metric":"latency","value":20}',
    ].join("\n") + "\n",
    "utf8",
  );
  await writeFile(
    join(root, "logs.jsonl"),
    [
      '{"timestamp":1,"service":"checkoutservice","message":"started"}',
      '{"timestamp":2,"service":"checkoutservice","message":"deadline exceeded"}',
    ].join("\n") + "\n",
    "utf8",
  );
  await writeFile(
    join(root, "traces.jsonl"),
    [
      '{"timestamp":1,"service":"checkoutservice","status":"ok","duration_ms":10}',
      '{"timestamp":2,"service":"checkoutservice","status":"error","duration_ms":200}',
    ].join("\n") + "\n",
    "utf8",
  );
  return root;
}

test("blocks tool execution before exact approval", async () => {
  const root = await caseRoot();
  const ledger = new FixtureApprovalLedger(
    [approval("read_incident_scope", "read", {})],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const metrics = harness.tools.find((tool) => tool.name === "aggregate_metrics");
  await assert.rejects(metrics!.handler({}), /No exact simulated approval/);
  assert.equal(harness.traces[0]?.status, "blocked");
});

test("returns source-specific baseline and post-onset query guidance", async () => {
  const root = await caseRoot();
  const ledger = new FixtureApprovalLedger(
    [approval("read_incident_scope", "read", {})],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const scope = harness.tools.find((tool) => tool.name === "read_incident_scope");
  const result = JSON.parse(await scope!.handler({})) as {
    data: {
      queryGuidance: {
        baselineWindow: { startTime: number; endTime: number };
        postOnsetWindow: { startTime: number; endTime: number };
        tracePostOnsetWindow: { startTime: number; endTime: number };
      };
    };
  };
  assert.deepEqual(result.data.queryGuidance.baselineWindow, {
    startTime: 1699999700,
    endTime: 1700000000,
  });
  assert.deepEqual(result.data.queryGuidance.postOnsetWindow, {
    startTime: 1700000000,
    endTime: 1700000300,
  });
  assert.deepEqual(result.data.queryGuidance.tracePostOnsetWindow, {
    startTime: 1700000000000,
    endTime: 1700000300000,
  });
});

test("rejects an approved evidence call without a bounded time window", async () => {
  const root = await caseRoot();
  const ledger = new FixtureApprovalLedger(
    [approval("aggregate_metrics", "aggregate", {})],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const metrics = harness.tools.find((tool) => tool.name === "aggregate_metrics");
  await assert.rejects(metrics!.handler({}), /Invalid time value/);
  assert.equal(harness.traces[0]?.status, "error");
});

test("returns metric aggregates and explicit source metadata", async () => {
  const root = await caseRoot();
  const parameters = {
    startTime: 1,
    endTime: 3,
    service: "checkoutservice",
    metric: "latency",
  };
  const ledger = new FixtureApprovalLedger(
    [approval("aggregate_metrics", "aggregate", parameters)],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const tool = harness.tools.find((candidate) => candidate.name === "aggregate_metrics");
  const result = JSON.parse(await tool!.handler(parameters)) as {
    rowCount: number;
    matchedRowCount: number;
    truncated: boolean;
    sourceComplete: boolean;
    data: { aggregates: readonly { average: number }[] };
  };
  assert.equal(result.rowCount, 2);
  assert.equal(result.matchedRowCount, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.sourceComplete, true);
  assert.equal(result.data.aggregates[0]?.average, 15);
  assert.equal(harness.traces[0]?.status, "executed");
  assert.match(harness.traces[0]?.resultHash ?? "", /^[0-9a-f]{64}$/);
});

test("aggregates the RCAEval wide metric schema by field name and unit", async () => {
  const root = await caseRoot();
  await writeFile(
    join(root, "metrics.jsonl"),
    [
      '{"time":"1","adservice_cpu":90,"checkoutservice_cpu":10}',
      '{"time":"2","adservice_cpu":100,"checkoutservice_cpu":20}',
    ].join("\n") + "\n",
    "utf8",
  );
  const parameters = {
    startTime: 1,
    endTime: 3,
    service: "adservice",
    metric: "cpu",
  };
  const ledger = new FixtureApprovalLedger(
    [approval("aggregate_metrics", "aggregate", parameters)],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const tool = harness.tools.find((candidate) => candidate.name === "aggregate_metrics");
  const result = JSON.parse(await tool!.handler(parameters)) as {
    data: { aggregates: readonly { field: string; average: number; unit: string }[] };
  };
  assert.deepEqual(result.data.aggregates, [
    { average: 95, count: 2, field: "adservice_cpu", maximum: 100, minimum: 90, unit: "percent" },
  ]);
});

test("ranks compact baseline-to-post metric changes", async () => {
  const root = await caseRoot();
  await writeFile(
    join(root, "metrics.jsonl"),
    [
      '{"time":"1","adservice_cpu":10,"cartservice_cpu":20}',
      '{"time":"1.2","adservice_cpu":10,"cartservice_cpu":20}',
      '{"time":"2","adservice_cpu":80,"cartservice_cpu":22}',
      '{"time":"2.2","adservice_cpu":100,"cartservice_cpu":18}',
    ].join("\n") + "\n",
    "utf8",
  );
  const parameters = {
    baselineStartTime: 1,
    baselineEndTime: 1.5,
    postStartTime: 2,
    postEndTime: 2.5,
    limit: 2,
  };
  const ledger = new FixtureApprovalLedger(
    [approval("compare_metrics", "compare", parameters)],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const tool = harness.tools.find((candidate) => candidate.name === "compare_metrics");
  const result = JSON.parse(await tool!.handler(parameters)) as {
    data: {
      comparisons: readonly {
        field: string;
        baselineAverage: number;
        postOnsetAverage: number;
      }[];
    };
  };
  assert.deepEqual(result.data.comparisons[0], {
    absoluteChange: 80,
    baselineAverage: 10,
    baselineCount: 2,
    field: "adservice_cpu",
    postOnsetAverage: 90,
    postOnsetCount: 2,
    relativeChange: 8,
    unit: "percent",
  });
});

test("searches escaped log literals with fixed limits", async () => {
  const root = await caseRoot();
  const parameters = {
    literal: "deadline exceeded",
    startTime: 1,
    endTime: 3,
    limit: 1,
  };
  const ledger = new FixtureApprovalLedger(
    [approval("search_logs", "search", parameters)],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const tool = harness.tools.find((candidate) => candidate.name === "search_logs");
  const result = JSON.parse(await tool!.handler(parameters)) as {
    matchedRowCount: number;
    data: { rows: readonly { message: string }[] };
  };
  assert.equal(result.matchedRowCount, 1);
  assert.equal(result.data.rows[0]?.message, "deadline exceeded");
});

test("summarizes traces by bounded status and duration", async () => {
  const root = await caseRoot();
  const parameters = {
    startTime: 1,
    endTime: 3,
    status: "error",
    minimumDuration: 100,
    limit: 10,
  };
  const ledger = new FixtureApprovalLedger(
    [approval("summarize_traces", "summarize", parameters)],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const tool = harness.tools.find((candidate) => candidate.name === "summarize_traces");
  const result = JSON.parse(await tool!.handler(parameters)) as {
    matchedRowCount: number;
    data: { groups: readonly { status: string; count: number }[] };
  };
  assert.equal(result.matchedRowCount, 1);
  assert.deepEqual(result.data.groups, [
    { service: "checkoutservice", status: "error", count: 1 },
  ]);
});

test("supports RCAEval trace field names and numeric strings", async () => {
  const root = await caseRoot();
  await writeFile(
    join(root, "traces.jsonl"),
    '{"startTimeMillis":"1705665791001","serviceName":"checkoutservice","statusCode":"2","duration":"200"}\n',
    "utf8",
  );
  const parameters = {
    startTime: 1705665791000,
    endTime: 1705665791002,
    service: "checkoutservice",
    status: "2",
    minimumDuration: 100,
    limit: 10,
  };
  const ledger = new FixtureApprovalLedger(
    [approval("summarize_traces", "summarize", parameters)],
    () => new Date(NOW),
  );
  const harness = createEvidenceTools({ caseRoot: root, ledger, clock: () => new Date(NOW) });
  const tool = harness.tools.find((candidate) => candidate.name === "summarize_traces");
  const result = JSON.parse(await tool!.handler(parameters)) as {
    matchedRowCount: number;
    data: { groups: readonly { service: string; status: string; count: number }[] };
  };
  assert.equal(result.matchedRowCount, 1);
  assert.deepEqual(result.data.groups, [
    { service: "checkoutservice", status: "2", count: 1 },
  ]);
});
