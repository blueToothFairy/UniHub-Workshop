import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const demoRoot = path.resolve(__dirname, "..");
const backendRoot = path.resolve(demoRoot, "..", "..");
const scenarioDir = __dirname;

const steps = [
  path.resolve(demoRoot, "00_setup", "run.mjs"),
  path.resolve(demoRoot, "01_peak_admission", "run.mjs"),
  path.resolve(demoRoot, "02_idempotency", "run.mjs"),
  path.resolve(demoRoot, "03_oversell", "run.mjs"),
  path.resolve(demoRoot, "04_circuit_breaker", "run.mjs")
];

function nowTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function latestTxtMeta(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".txt"))
    .map((name) => {
      const fullPath = path.resolve(dirPath, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] ?? null;
}

function newestTxtAfter(dirPath, baselineMtimeMs) {
  if (!fs.existsSync(dirPath)) return null;
  const candidates = fs.readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".txt"))
    .map((name) => {
      const fullPath = path.resolve(dirPath, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .filter((item) => item.mtimeMs > baselineMtimeMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
}

function runStep(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: backendRoot,
      stdio: "inherit",
      env: process.env
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Step failed (${scriptPath}), exit code=${code}`));
    });
  });
}

function buildSummaryText(input) {
  const lines = [];
  lines.push(`Demo summary generated at: ${new Date().toISOString()}`);
  lines.push(`Run tag: ${input.runTag}`);
  lines.push(`Overall status: ${input.overallStatus}`);
  lines.push(`Total duration ms: ${input.totalDurationMs}`);
  lines.push("");
  lines.push("Steps:");
  for (const step of input.steps) {
    lines.push(`- ${step.name}`);
    lines.push(`  status: ${step.status}`);
    lines.push(`  durationMs: ${step.durationMs}`);
    lines.push(`  script: ${step.scriptRelative}`);
    lines.push(`  logFile: ${step.logFileRelative ?? "(not found)"}`);
    if (step.error) {
      lines.push(`  error: ${step.error}`);
    }
  }
  lines.push("");
  lines.push("Note:");
  lines.push("`logFile` points to the newest .txt produced for each part during this run.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const runTag = nowTag();
  const startedAt = Date.now();
  const stepResults = [];
  let overallStatus = "passed";

  console.log("Running full demo scenario...");
  for (const step of steps) {
    const stepStart = Date.now();
    const scriptRelative = path.relative(backendRoot, step);
    const partDir = path.dirname(step);
    const beforeMeta = latestTxtMeta(partDir);
    const beforeMtimeMs = beforeMeta?.mtimeMs ?? 0;

    console.log(`\n--- Running: ${scriptRelative} ---`);
    try {
      await runStep(step);
      const afterNew = newestTxtAfter(partDir, beforeMtimeMs) ?? latestTxtMeta(partDir);
      stepResults.push({
        name: path.basename(partDir),
        status: "passed",
        durationMs: Date.now() - stepStart,
        scriptRelative,
        logFileRelative: afterNew ? path.relative(backendRoot, afterNew.fullPath) : null
      });
    } catch (error) {
      overallStatus = "failed";
      const afterNew = newestTxtAfter(partDir, beforeMtimeMs) ?? latestTxtMeta(partDir);
      stepResults.push({
        name: path.basename(partDir),
        status: "failed",
        durationMs: Date.now() - stepStart,
        scriptRelative,
        logFileRelative: afterNew ? path.relative(backendRoot, afterNew.fullPath) : null,
        error: error instanceof Error ? error.message : String(error)
      });
      break;
    }
  }

  const summaryText = buildSummaryText({
    runTag,
    overallStatus,
    totalDurationMs: Date.now() - startedAt,
    steps: stepResults
  });

  const summaryStablePath = path.resolve(scenarioDir, "summary.txt");
  const summaryArchivePath = path.resolve(scenarioDir, `summary-${runTag}.txt`);
  fs.writeFileSync(summaryStablePath, summaryText, "utf8");
  fs.writeFileSync(summaryArchivePath, summaryText, "utf8");

  console.log(`\nSummary written: ${path.relative(backendRoot, summaryStablePath)}`);
  console.log(`Summary archive: ${path.relative(backendRoot, summaryArchivePath)}`);

  if (overallStatus === "failed") {
    throw new Error("One or more steps failed. Check summary.txt for details.");
  }

  console.log("\nFull demo scenario completed.");
}

main().catch((error) => {
  console.error("Full scenario failed:", error);
  process.exit(1);
});
