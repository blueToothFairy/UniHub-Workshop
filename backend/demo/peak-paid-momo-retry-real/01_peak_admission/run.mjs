import path from "node:path";
import {
  DEMO_ROOT,
  createPartLogger,
  loadContext,
  mergeContext,
  requestAdmission
} from "../_shared/demo-lib.mjs";

async function run() {
  const partDir = path.resolve(DEMO_ROOT, "01_peak_admission");
  const logger = createPartLogger(partDir);
  const context = loadContext();

  const { peakWorkshopId } = context.workshops;
  const students = context.students;

  logger.section("Part 1 - Peak Admission Burst");
  logger.log(`Workshop ID: ${peakWorkshopId}`);
  logger.log(`Students: ${students.map((s) => s.label).join(", ")}`);

  logger.section(`Step 1 - ${students.length} Students Request Admission Concurrently`);
  const admissionResults = await Promise.all(
    students.map(async (student) => {
      const rs = await requestAdmission(student.token, peakWorkshopId);
      const gate = rs.body?.data?.status ?? rs.body?.error?.code ?? rs.body?.error ?? "unknown";
      const token = rs.body?.data?.admission_token ?? null;
      return {
        student: student.label,
        statusCode: rs.status,
        gateStatus: gate,
        queuePosition: rs.body?.data?.queue_position ?? null,
        retryAfter: rs.body?.retry_after ?? rs.body?.data?.retry_after ?? null,
        admissionToken: token
      };
    })
  );

  const counters = {
    admitted: 0,
    waiting: 0,
    full: 0,
    rateLimited: 0,
    other: 0
  };
  for (const result of admissionResults) {
    if (result.statusCode === 200 && result.gateStatus === "admitted") counters.admitted += 1;
    else if (result.statusCode === 200 && result.gateStatus === "waiting") counters.waiting += 1;
    else if (result.statusCode === 200 && result.gateStatus === "full") counters.full += 1;
    else if (result.statusCode === 429) counters.rateLimited += 1;
    else counters.other += 1;
    logger.log(`${result.student} -> status=${result.statusCode}, gate=${result.gateStatus}, queue=${result.queuePosition ?? "-"}, retry_after=${result.retryAfter ?? "-"}`);
  }

  logger.log(`Summary: ${JSON.stringify(counters)}`);

  logger.section("Step 2 - student03 Spam Admission Immediately");
  const student03 = students.find((s) => s.label === "student03");
  if (!student03) {
    throw new Error("student03 not found in context");
  }
  const spamRs = await requestAdmission(student03.token, peakWorkshopId);
  logger.log(`student03 spam -> status=${spamRs.status}, body=${JSON.stringify(spamRs.body)}`);

  const tokensByStudent = {};
  for (const row of admissionResults) {
    if (row.admissionToken) {
      tokensByStudent[row.student] = row.admissionToken;
    }
  }

  mergeContext({
    admission: {
      tokensByWorkshop: {
        [peakWorkshopId]: tokensByStudent
      }
    },
    part1: {
      admissionResults,
      counters,
      student03Spam: {
        status: spamRs.status,
        body: spamRs.body
      }
    }
  });

  logger.section("Part 1 Completed");
  logger.log("Saved admission tokens for admitted students into runtime context.");
  logger.log(`Log file: ${logger.filePath}`);
}

run().catch((error) => {
  console.error("Part 1 failed:", error);
  process.exit(1);
});
