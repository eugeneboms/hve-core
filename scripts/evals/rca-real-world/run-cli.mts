// Copyright (c) 2026 Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";

import { runRound } from "./runner.mts";
import { EVALUATION_RUN_DIRECTORY, readJson, writeJson } from "./contracts.mts";
import { parseEvaluationMode, type EvaluationMode } from "./conditions.mts";

/** Parses execution options without starting a model or opening an interactive prompt. */
export function parseRunArguments(args: readonly string[]): {
  readonly runId: string;
  readonly round: 1 | 2 | 3;
  readonly mode?: EvaluationMode;
  readonly interactive: boolean;
} {
  const { values } = parseArgs({
    args: [...args],
    options: {
      "run-id": { type: "string" },
      round: { type: "string" },
      conditions: { type: "string" },
      interactive: { type: "boolean", default: false },
    },
  });
  const round = Number(values.round);
  if (
    !values["run-id"] || !["1", "2", "3"].includes(values.round ?? "") ||
    (round !== 1 && round !== 2 && round !== 3)
  ) {
    throw new Error("Usage: npm run ci:rca-eval -- --run-id <run-id> --round <1|2|3> [--conditions both|with-skill|without-skill] [--interactive]");
  }
  return {
    runId: values["run-id"],
    round,
    mode: values.conditions === undefined ? undefined : parseEvaluationMode(values.conditions),
    interactive: values.interactive,
  };
}

/** Asks only for a new interactive run; resumed runs inherit their recorded conditions. */
export async function selectEvaluationMode(options: {
  readonly mode?: EvaluationMode;
  readonly round: 1 | 2 | 3;
  readonly interactive: boolean;
  readonly ask: (question: string) => Promise<string>;
}): Promise<EvaluationMode | undefined> {
  if (options.mode !== undefined || options.round !== 1) {
    return options.mode;
  }
  if (!options.interactive) {
    return "both";
  }
  const answer = await options.ask(
    "Run both conditions, with-skill only, or without-skill only? [both/with-skill/without-skill] (both): ",
  );
  return parseEvaluationMode(answer.trim() || "both");
}

if (import.meta.main) {
  const options = parseRunArguments(process.argv.slice(2));
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (options.interactive && !tty && options.round === 1 && options.mode === undefined) {
    throw new Error("Interactive condition selection requires a terminal; use --conditions for automation");
  }
  const mode = await selectEvaluationMode({
    ...options,
    interactive: options.interactive || tty,
    ask: async (question) => {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await input.question(question);
      } finally {
        input.close();
      }
    },
  });
  const summary = await runRound({
    repositoryRoot: resolve(import.meta.dirname, "..", "..", ".."),
    runId: options.runId,
    round: options.round,
    mode,
  });

  const runRoot = join(
    resolve(import.meta.dirname, "..", "..", ".."),
    ".copilot-tracking",
    "evaluations",
    EVALUATION_RUN_DIRECTORY,
    options.runId,
  );
  const commandPath = join(runRoot, "commands.json");
  const existing = await readJson<{
    schemaVersion: string;
    commands: readonly unknown[];
  }>(commandPath);
  await writeJson(commandPath, {
    schemaVersion: existing.schemaVersion,
    commands: [
      ...existing.commands,
      {
        command: `node scripts/evals/rca-real-world/run-cli.mts --run-id ${options.runId} --round ${options.round} --conditions ${summary.mode}`,
        exitCode: 0,
        purpose: `Execute and score trial round ${options.round} (${summary.mode})`,
      },
    ],
  });

  process.stdout.write(
    `${JSON.stringify({
      runId: summary.runId,
      conditions: summary.mode,
      completedTrials: summary.trials.length,
      roundOneDecision: summary.roundOneCheckpoint?.decision,
    })}\n`,
  );
}
