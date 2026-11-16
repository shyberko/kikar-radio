/** Long-running clock. Dispatches bulletin, upload, and scan, then starts the next copy. */

import { jerusalemParts } from "../site/js/pure.js";
import { SCHEDULER_RUN_MINUTES, applySchedulerAction, schedulerTick } from "./scheduler-plan.js";

const repo = process.env.GITHUB_REPOSITORY || "shyberko/kikar-radio";
const runId = String(process.env.GITHUB_RUN_ID || "");
const api = "https://api.github.com";
const files = {
  bulletin: "bulletin.yml",
  upload: "upload.yml",
  scan: "scan.yml",
  scheduler: "scheduler.yml",
};
const events = {
  bulletin: "kikar-bulletin",
  upload: "kikar-upload",
  scan: "kikar-scan",
  scheduler: "kikar-scheduler",
};

function readToken() {
  const pat = String(process.env.SCHEDULER_PAT || "").trim();
  const github = String(process.env.GITHUB_TOKEN || "").trim();
  return { pat, github, dispatch: pat || github };
}

function loadState() {
  const raw = String(process.env.SCHEDULER_STATE || "").trim();
  if (!raw || raw === "null" || raw === "{}") return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return {
      bulletinKey: String(parsed.bulletinKey || ""),
      uploadKey: String(parsed.uploadKey || ""),
      scanKey: String(parsed.scanKey || ""),
      handoffFrom: String(parsed.handoffFrom || ""),
    };
  } catch {
    return {};
  }
}

async function gh(token, method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function anotherSchedulerRunning(token, ignoreIds) {
  const res = await gh(token, "GET", `/repos/${repo}/actions/workflows/scheduler.yml/runs?status=in_progress&per_page=20`);
  if (res.status !== 200) {
    console.log(`לא הצלחנו לקרוא ריצות מתזמן (${res.status}). ממשיכים.`);
    return false;
  }
  let data = {};
  try {
    data = JSON.parse(res.text);
  } catch {
    return false;
  }
  return (data.workflow_runs || []).some((row) => !ignoreIds.has(String(row.id)));
}

async function repositoryDispatch(token, eventType, payload) {
  return gh(token, "POST", `/repos/${repo}/dispatches`, {
    event_type: eventType,
    client_payload: payload || {},
  });
}

async function workflowDispatch(token, file) {
  return gh(token, "POST", `/repos/${repo}/actions/workflows/${file}/dispatches`, { ref: "main" });
}

async function send(kind) {
  const { pat, github } = readToken();
  const tokens = [...new Set([pat, github].filter(Boolean))];
  const eventType = events[kind];
  const file = files[kind];
  let last = "no token";
  for (const token of tokens) {
    const viaRepo = await repositoryDispatch(token, eventType, kind === "scheduler" ? undefined : { at: new Date().toISOString() });
    if (viaRepo.status === 204) return "repository_dispatch";
    last = `repository_dispatch ${viaRepo.status}`;
    const viaWorkflow = await workflowDispatch(token, file);
    if (viaWorkflow.status === 204) return "workflow_dispatch";
    last = `workflow_dispatch ${viaWorkflow.status}`;
  }
  throw new Error(last);
}

async function handoff(state) {
  const { pat, github } = readToken();
  const tokens = [...new Set([pat, github].filter(Boolean))];
  const payload = {
    bulletinKey: state.bulletinKey || "",
    uploadKey: state.uploadKey || "",
    scanKey: state.scanKey || "",
    handoffFrom: runId,
  };
  let last = "no token";
  for (const token of tokens) {
    const viaRepo = await repositoryDispatch(token, events.scheduler, payload);
    if (viaRepo.status === 204) return "repository_dispatch";
    last = `repository_dispatch ${viaRepo.status} ${viaRepo.text.slice(0, 180)}`;
    const viaWorkflow = await workflowDispatch(token, files.scheduler);
    if (viaWorkflow.status === 204) return "workflow_dispatch";
    last = `workflow_dispatch ${viaWorkflow.status} ${viaWorkflow.text.slice(0, 180)}`;
  }
  console.log("המתזמן לא הצליח להפעיל את העותק הבא.");
  console.log("אם שתי הקריאות החזירו 403, הוסיפו סוד בשם SCHEDULER_PAT:");
  console.log("Fine-grained token רק ל-shyberko/kikar-radio, Contents ו-Actions לכתיבה.");
  throw new Error(last.slice(0, 300));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poke() {
  const how = await send("scheduler");
  console.log(`בקשת הפעלת מתזמן נשלחה (${how}). אם מתזמן כבר רץ, העותק החדש יוצא מיד.`);
}

async function main() {
  if (process.argv.includes("--poke")) {
    await poke();
    return;
  }
  const { pat, github } = readToken();
  console.log(`מתזמן התחיל. אימות: ${pat ? "SCHEDULER_PAT" : "GITHUB_TOKEN"}.`);
  const state0 = loadState();
  const ignore = new Set([runId, state0.handoffFrom].filter(Boolean));
  if (await anotherSchedulerRunning(github || pat, ignore)) {
    console.log("מתזמן אחר כבר רץ. יוצאים בלי חלון נוסף.");
    return;
  }
  let state = state0;
  const started = Date.now();
  const limit = SCHEDULER_RUN_MINUTES * 60 * 1000;
  let heartbeat = "";
  console.log(`חלון ריצה: ${SCHEDULER_RUN_MINUTES} דקות. אחר כך מופעל עותק חדש.`);
  while (Date.now() - started < limit) {
    const parts = jerusalemParts(new Date());
    const plan = schedulerTick(parts, state);
    for (const action of plan.actions) {
      try {
        const how = await send(action.kind);
        state = applySchedulerAction(state, action);
        console.log(`הופעל ${action.kind} ${action.key} (${how})`);
      } catch (err) {
        console.log(`לא הצלחנו להפעיל ${action.kind}: ${String(err.message || err).slice(0, 180)}`);
      }
    }
    const mark = `${parts.hour}:${parts.minute}`;
    if (parts.minute % 10 === 0 && heartbeat !== mark) {
      heartbeat = mark;
      const hh = String(parts.hour).padStart(2, "0");
      const mm = String(parts.minute).padStart(2, "0");
      console.log(`מתזמן חי. שעון ישראל ${hh}:${mm}.`);
    }
    const remain = limit - (Date.now() - started);
    if (remain <= 20_000) break;
    await sleep(Math.min(20_000, remain));
  }
  const how = await handoff(state);
  console.log(`העותק הבא הופעל (${how}).`);
}

main().catch((err) => {
  console.error(String(err.message || err).slice(0, 400));
  process.exit(1);
});
