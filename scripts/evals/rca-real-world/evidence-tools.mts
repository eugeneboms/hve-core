// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { resolveInside, sha256, stableJson, type Modality } from "./contracts.mts";

export interface EvidenceToolTrace {
  readonly sequence: number;
  readonly tool: string;
  readonly operation: string;
  readonly normalizedParameters: Readonly<Record<string, unknown>>;
  readonly approvalId?: string;
  readonly status: "executed" | "blocked" | "error";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly resultHash?: string;
  readonly error?: string;
}

export interface EvidenceToolResult {
  readonly source: Modality | "incident";
  readonly rowCount: number;
  readonly matchedRowCount: number;
  readonly truncated: boolean;
  readonly sourceComplete: boolean;
  readonly empty: boolean;
  readonly data: unknown;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly handler: (parameters: Record<string, unknown>) => Promise<string>;
}

export interface ApprovalConsumer {
  consume(tool: string, operation: string, parameters: Readonly<Record<string, unknown>>): string;
}

const MAX_CALLS = 24;
const MAX_RESULT_ROWS = 100;
const MAX_RESULT_BYTES = 64 * 1024;

/**
 * Creates allowlisted read-only evidence operations for one neutral case.
 *
 * Every handler consumes an exact fixture approval before reading evidence and returns coverage,
 * truncation, row-count, and empty-result metadata. Files outside `caseRoot` are unreachable.
 */
export function createEvidenceTools(options: {
  readonly caseRoot: string;
  readonly ledger: ApprovalConsumer;
  readonly clock?: () => Date;
}): { readonly tools: readonly ToolDefinition[]; readonly traces: EvidenceToolTrace[] } {
  const traces: EvidenceToolTrace[] = [];
  const clock = options.clock ?? (() => new Date());
  let calls = 0;

  const execute = async (
    tool: string,
    operation: string,
    parameters: Record<string, unknown>,
    action: () => Promise<EvidenceToolResult>,
  ): Promise<string> => {
    const startedAt = clock().toISOString();
    const normalizedParameters = normalizeParameters(parameters);
    let approvalId: string | undefined;
    try {
      calls += 1;
      if (calls > MAX_CALLS) {
        throw new Error(`Evidence call limit exceeded (${MAX_CALLS})`);
      }
      approvalId = options.ledger.consume(tool, operation, normalizedParameters);
      const result = await action();
      const serialized = stableJson(result);
      if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
        throw new Error(`Evidence result exceeds ${MAX_RESULT_BYTES} bytes`);
      }
      traces.push({
        sequence: traces.length + 1,
        tool,
        operation,
        normalizedParameters,
        approvalId,
        status: "executed",
        startedAt,
        completedAt: clock().toISOString(),
        resultHash: sha256(serialized),
      });
      return serialized;
    } catch (error) {
      traces.push({
        sequence: traces.length + 1,
        tool,
        operation,
        normalizedParameters,
        approvalId,
        status: approvalId ? "error" : "blocked",
        startedAt,
        completedAt: clock().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  return {
    traces,
    tools: [
      {
        name: "read_incident_scope",
        description:
          "Read neutral incident onset, available evidence sources, coverage, and statistical-unit limitations. Read-only and bounded to the current case.",
        parameters: objectSchema({}),
        handler: (parameters) =>
          execute("read_incident_scope", "read", parameters, async () => {
            requireExactKeys(parameters, []);
            const incident = JSON.parse(
              await readFile(resolveInside(options.caseRoot, "incident.json"), "utf8"),
            ) as unknown;
            const coverage = JSON.parse(
              await readFile(resolveInside(options.caseRoot, "source-coverage.json"), "utf8"),
            ) as { sources?: readonly { rowCount?: number }[] };
            const rowCount =
              coverage.sources?.reduce((sum, source) => sum + (source.rowCount ?? 0), 0) ?? 0;
            const onset = Number((incident as { incidentOnset?: unknown }).incidentOnset);
            const queryGuidance = Number.isFinite(onset)
              ? {
                  metricAndLogTimeUnit: "epoch seconds",
                  traceTimeUnit: "epoch milliseconds",
                  baselineWindow: { startTime: onset - 300, endTime: onset },
                  postOnsetWindow: { startTime: onset, endTime: onset + 300 },
                  traceBaselineWindow: {
                    startTime: (onset - 300) * 1000,
                    endTime: onset * 1000,
                  },
                  tracePostOnsetWindow: {
                    startTime: onset * 1000,
                    endTime: (onset + 300) * 1000,
                  },
                }
              : "Unavailable - incident onset is not numeric";
            return result(
              "incident",
              2,
              2,
              false,
              { incident, coverage, queryGuidance },
              rowCount > 0,
            );
          }),
      },
      {
        name: "aggregate_metrics",
        description:
          "Aggregate numeric metric values over a bounded time window with optional exact service and metric filters. Returns units when present and row counts.",
        parameters: objectSchema(
          {
            startTime: scalarSchema(),
            endTime: scalarSchema(),
            service: { type: "string", maxLength: 128 },
            metric: { type: "string", maxLength: 256 },
          },
          ["startTime", "endTime"],
        ),
        handler: (parameters) =>
          execute("aggregate_metrics", "aggregate", parameters, async () => {
            requireAllowedKeys(parameters, ["startTime", "endTime", "service", "metric"]);
            const window = requireTimeWindow(parameters);
            const rows = await selectRows(
              resolveInside(options.caseRoot, "metrics.jsonl"),
              parameters,
              Number.MAX_SAFE_INTEGER,
            );
            const aggregates = aggregateNumeric(rows.rows, parameters);
            return result(
              "metrics",
              rows.scanned,
              rows.matched,
              false,
              { window, aggregates },
              rows.scanned > 0,
            );
          }),
      },
      {
        name: "compare_metrics",
        description:
          "Compare bounded baseline and post-onset metric windows, ranking field changes with units and row counts. Optional service and metric filters match wide metric field names.",
        parameters: objectSchema(
          {
            baselineStartTime: scalarSchema(),
            baselineEndTime: scalarSchema(),
            postStartTime: scalarSchema(),
            postEndTime: scalarSchema(),
            service: { type: "string", maxLength: 128 },
            metric: { type: "string", maxLength: 256 },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
          [
            "baselineStartTime",
            "baselineEndTime",
            "postStartTime",
            "postEndTime",
          ],
        ),
        handler: (parameters) =>
          execute("compare_metrics", "compare", parameters, async () => {
            requireAllowedKeys(parameters, [
              "baselineStartTime",
              "baselineEndTime",
              "postStartTime",
              "postEndTime",
              "service",
              "metric",
              "limit",
            ]);
            const baselineWindow = requireTimeWindow({
              startTime: parameters.baselineStartTime,
              endTime: parameters.baselineEndTime,
            });
            const postOnsetWindow = requireTimeWindow({
              startTime: parameters.postStartTime,
              endTime: parameters.postEndTime,
            });
            const sharedFilters = {
              ...(parameters.service === undefined ? {} : { service: parameters.service }),
              ...(parameters.metric === undefined ? {} : { metric: parameters.metric }),
            };
            const path = resolveInside(options.caseRoot, "metrics.jsonl");
            const baseline = await selectRows(path, {
              ...sharedFilters,
              startTime: baselineWindow.startTime,
              endTime: baselineWindow.endTime,
            }, Number.MAX_SAFE_INTEGER);
            const postOnset = await selectRows(path, {
              ...sharedFilters,
              startTime: postOnsetWindow.startTime,
              endTime: postOnsetWindow.endTime,
            }, Number.MAX_SAFE_INTEGER);
            const limit =
              parameters.limit === undefined ? 20 : requireNumber(parameters.limit, "limit");
            const comparisons = compareMetricAggregates(
              aggregateNumeric(baseline.rows, sharedFilters),
              aggregateNumeric(postOnset.rows, sharedFilters),
              limit,
            );
            return result(
              "metrics",
              baseline.scanned + postOnset.scanned,
              baseline.matched + postOnset.matched,
              false,
              {
                baselineWindow,
                postOnsetWindow,
                baselineRowCount: baseline.matched,
                postOnsetRowCount: postOnset.matched,
                comparisons,
              },
              baseline.scanned > 0 || postOnset.scanned > 0,
            );
          }),
      },
      {
        name: "search_logs",
        description:
          "Retrieve incident-centered logs over a required bounded time window, optionally filtering by one escaped literal and exact service. Returns at most 100 rows with coverage and truncation metadata.",
        parameters: objectSchema(
          {
            literal: { type: "string", minLength: 1, maxLength: 256 },
            startTime: scalarSchema(),
            endTime: scalarSchema(),
            service: { type: "string", maxLength: 128 },
            limit: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS },
          },
          ["startTime", "endTime"],
        ),
        handler: (parameters) =>
          execute("search_logs", "search", parameters, async () => {
            requireAllowedKeys(parameters, ["literal", "startTime", "endTime", "service", "limit"]);
            const window = requireTimeWindow(parameters);
            const literal =
              parameters.literal === undefined
                ? undefined
                : requireString(parameters.literal, "literal").toLowerCase();
            const limit = requireLimit(parameters.limit);
            const rows = await selectRows(
              resolveInside(options.caseRoot, "logs.jsonl"),
              parameters,
              limit + 1,
              (row) =>
                literal === undefined || stableJson(row).toLowerCase().includes(literal),
            );
            const truncated = rows.rows.length > limit;
            return result(
              "logs",
              rows.scanned,
              rows.matched,
              truncated,
              { window, literal: literal ?? null, rows: rows.rows.slice(0, limit) },
              rows.scanned > 0,
            );
          }),
      },
      {
        name: "summarize_traces",
        description:
          "Summarize bounded trace evidence by service and status with optional duration threshold. Returns at most 100 representative rows.",
        parameters: objectSchema(
          {
            startTime: scalarSchema(),
            endTime: scalarSchema(),
            service: { type: "string", maxLength: 128 },
            status: { type: "string", maxLength: 64 },
            minimumDuration: { type: "number", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS },
          },
          ["startTime", "endTime"],
        ),
        handler: (parameters) =>
          execute("summarize_traces", "summarize", parameters, async () => {
            requireAllowedKeys(parameters, [
              "startTime",
              "endTime",
              "service",
              "status",
              "minimumDuration",
              "limit",
            ]);
            const window = requireTimeWindow(parameters);
            const limit = requireLimit(parameters.limit);
            const groups = new Map<string, number>();
            const rows = await selectRows(
              resolveInside(options.caseRoot, "traces.jsonl"),
              parameters,
              limit + 1,
              (row) => matchesStatusAndDuration(row, parameters),
              (row) => addTraceGroup(groups, row),
            );
            const truncated = rows.rows.length > limit;
            return result(
              "traces",
              rows.scanned,
              rows.matched,
              truncated,
              {
                window,
                groups: renderTraceGroups(groups),
                representativeRows: rows.rows.slice(0, limit),
              },
              rows.scanned > 0,
            );
          }),
      },
    ],
  };
}

async function selectRows(
  path: string,
  parameters: Readonly<Record<string, unknown>>,
  resultLimit: number,
  additionalPredicate: (row: Record<string, unknown>) => boolean = () => true,
  onMatch: (row: Record<string, unknown>) => void = () => undefined,
): Promise<{
  readonly rows: Record<string, unknown>[];
  readonly scanned: number;
  readonly matched: number;
}> {
  const rows: Record<string, unknown>[] = [];
  let scanned = 0;
  let matched = 0;
  const input = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) {
      continue;
    }
    scanned += 1;
    const row = JSON.parse(line) as Record<string, unknown>;
    if (!matchesCommonFilters(row, parameters) || !additionalPredicate(row)) {
      continue;
    }
    matched += 1;
    onMatch(row);
    if (rows.length < resultLimit) {
      rows.push(row);
    }
  }
  return { rows, scanned, matched };
}

function matchesCommonFilters(
  row: Readonly<Record<string, unknown>>,
  parameters: Readonly<Record<string, unknown>>,
): boolean {
  if (parameters.service !== undefined) {
    const service = requireString(parameters.service, "service").toLowerCase();
    const rowService = findString(row, [
      "service",
      "service_name",
      "serviceName",
      "container_name",
    ]).toLowerCase();
    if (rowService && !rowService.includes(service)) {
      return false;
    }
  }
  if (parameters.metric !== undefined) {
    const metric = requireString(parameters.metric, "metric").toLowerCase();
    const rowMetric = findString(row, ["metric", "metric_name", "name"]).toLowerCase();
    if (rowMetric && !rowMetric.includes(metric)) {
      return false;
    }
  }
  const timestamp = findTimestamp(row);
  if (parameters.startTime !== undefined && timestamp < comparable(parameters.startTime)) {
    return false;
  }
  if (parameters.endTime !== undefined && timestamp > comparable(parameters.endTime)) {
    return false;
  }
  return true;
}

function matchesStatusAndDuration(
  row: Readonly<Record<string, unknown>>,
  parameters: Readonly<Record<string, unknown>>,
): boolean {
  if (parameters.status !== undefined) {
    const status = requireString(parameters.status, "status").toLowerCase();
    if (
      !findString(row, ["status", "status_code", "statusCode", "http_status_code"])
        .toLowerCase()
        .includes(status)
    ) {
      return false;
    }
  }
  if (parameters.minimumDuration !== undefined) {
    const threshold = requireNumber(parameters.minimumDuration, "minimumDuration");
    const duration = findNumber(row, ["duration", "duration_ms", "latency", "latency_ms"]);
    if (duration === undefined || duration < threshold) {
      return false;
    }
  }
  return true;
}

function aggregateNumeric(
  rows: readonly Readonly<Record<string, unknown>>[],
  parameters: Readonly<Record<string, unknown>>,
): unknown {
  const values = new Map<string, number[]>();
  const service =
    typeof parameters.service === "string" ? parameters.service.toLowerCase() : undefined;
  const metric = typeof parameters.metric === "string" ? parameters.metric.toLowerCase() : undefined;
  const narrowRows = rows.some((row) => findString(row, ["metric", "metric_name", "name"]) !== "");
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = key.toLowerCase();
      const selected =
        narrowRows ||
        ((!service || normalizedKey.includes(service)) && (!metric || normalizedKey.includes(metric)));
      if (
        selected &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        !/time|timestamp/i.test(key)
      ) {
        const current = values.get(key) ?? [];
        current.push(value);
        values.set(key, current);
      }

    }
  }
  return [...values.entries()].map(([field, fieldValues]) => ({
    field,
    count: fieldValues.length,
    unit: inferMetricUnit(field),
    minimum: Math.min(...fieldValues),
    maximum: Math.max(...fieldValues),
    average: fieldValues.reduce((sum, value) => sum + value, 0) / fieldValues.length,
  }));
}

interface MetricAggregate {
  readonly field: string;
  readonly count: number;
  readonly unit: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly average: number;
}

function compareMetricAggregates(
  baselineValue: unknown,
  postOnsetValue: unknown,
  limit: number,
): readonly unknown[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("limit must be an integer from 1 through 50");
  }
  const baseline = baselineValue as readonly MetricAggregate[];
  const postOnset = postOnsetValue as readonly MetricAggregate[];
  const baselineByField = new Map(baseline.map((item) => [item.field, item]));
  return postOnset
    .filter((item) => baselineByField.has(item.field))
    .map((item) => {
      const before = baselineByField.get(item.field)!;
      const absoluteChange = item.average - before.average;
      const relativeChange =
        before.average === 0 ? null : absoluteChange / Math.abs(before.average);
      return {
        field: item.field,
        unit: item.unit,
        baselineAverage: before.average,
        postOnsetAverage: item.average,
        absoluteChange,
        relativeChange,
        baselineCount: before.count,
        postOnsetCount: item.count,
      };
    })
    .sort((left, right) => {
      const leftRank =
        left.relativeChange === null
          ? Math.abs(left.absoluteChange)
          : Math.abs(left.relativeChange);
      const rightRank =
        right.relativeChange === null
          ? Math.abs(right.absoluteChange)
          : Math.abs(right.relativeChange);
      return rightRank - leftRank;
    })
    .slice(0, limit);
}

function addTraceGroup(groups: Map<string, number>, row: Readonly<Record<string, unknown>>): void {
  const service =
    findString(row, ["service", "service_name", "serviceName", "container_name"]) || "unknown";
  const status =
    findString(row, ["status", "status_code", "statusCode", "http_status_code"]) || "unknown";
  const key = `${service}|${status}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}

function renderTraceGroups(groups: ReadonlyMap<string, number>): unknown {
  return [...groups.entries()].map(([key, count]) => {
    const [service, status] = key.split("|");
    return { service, status, count };
  });
}

function result(
  source: EvidenceToolResult["source"],
  rowCount: number,
  matchedRowCount: number,
  truncated: boolean,
  data: unknown,
  sourceComplete: boolean,
): EvidenceToolResult {
  return {
    source,
    rowCount,
    matchedRowCount,
    truncated,
    sourceComplete,
    empty: matchedRowCount === 0,
    data,
  };
}

function normalizeParameters(
  parameters: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return JSON.parse(stableJson(parameters)) as Record<string, unknown>;
}

function requireAllowedKeys(
  parameters: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  const extras = Object.keys(parameters).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new Error(`Unsupported parameters: ${extras.join(", ")}`);
  }
}

function requireExactKeys(
  parameters: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  requireAllowedKeys(parameters, expected);
  if (Object.keys(parameters).length !== expected.length) {
    throw new Error("Missing required parameters");
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function requireLimit(value: unknown): number {
  if (value === undefined) {
    return 20;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_RESULT_ROWS) {
    throw new Error(`limit must be an integer from 1 through ${MAX_RESULT_ROWS}`);
  }
  return value as number;
}

function findString(row: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  for (const key of keys) {
    if (typeof row[key] === "string") {
      return row[key];
    }
  }
  return "";
}

function findNumber(
  row: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function findTimestamp(row: Readonly<Record<string, unknown>>): number {
  for (const key of [
    "timestamp",
    "startTimeMillis",
    "start_time",
    "startTime",
    "time",
    "ts",
  ]) {
    if (row[key] !== undefined) {
      return comparable(row[key]);
    }
  }
  return Number.NEGATIVE_INFINITY;
}

function comparable(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Invalid time value: ${String(value)}`);
}

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  return { type: "object", additionalProperties: false, properties, required };
}

function scalarSchema(): Readonly<Record<string, unknown>> {
  return { anyOf: [{ type: "number" }, { type: "string", maxLength: 64 }] };
}

function inferMetricUnit(field: string): string {
  const normalized = field.toLowerCase();
  if (normalized.endsWith("_cpu")) {
    return "percent";
  }
  if (normalized.endsWith("_mem") || normalized.includes("memory")) {
    return "bytes";
  }
  if (normalized.includes("latency")) {
    return "seconds";
  }
  if (normalized.includes("duration")) {
    return "source-defined duration unit";
  }
  if (normalized.endsWith("_load") || normalized.endsWith("_error")) {
    return "count";
  }
  return "source-defined";
}

function requireTimeWindow(parameters: Readonly<Record<string, unknown>>): {
  readonly startTime: number;
  readonly endTime: number;
  readonly unit: "epoch seconds" | "epoch milliseconds";
} {
  const startTime = comparable(parameters.startTime);
  const endTime = comparable(parameters.endTime);
  if (endTime <= startTime) {
    throw new Error("endTime must be greater than startTime");
  }
  const unit = startTime > 100_000_000_000 ? "epoch milliseconds" : "epoch seconds";
  const maximumSpan = unit === "epoch milliseconds" ? 3_600_000 : 3_600;
  if (endTime - startTime > maximumSpan) {
    throw new Error(`Evidence time window exceeds the ${maximumSpan}-unit limit`);
  }
  return { startTime, endTime, unit };
}
