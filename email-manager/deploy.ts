/**
 * Ruflo Email Manager — n8n Workflow Deployer
 *
 * Reads credentials from /home/user/credentials/.env (never committed)
 * and deploys all 4 email-manager workflows to your n8n instance.
 *
 * Usage:
 *   npm run deploy          # deploy all workflows
 *   npm run deploy:dry      # dry-run (validate only, no API calls)
 */

import * as fs from "fs";
import * as path from "path";

// ── Load credentials from secure location ──────────────────────────────────
const CREDS_FILE =
  process.env.CREDS_FILE ||
  path.resolve(process.env.HOME || "/home/user", "credentials/.env");

function loadEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    console.error(`\n❌  Credentials file not found: ${filePath}`);
    console.error(`    Create it with your N8N_API_KEY and re-run.\n`);
    process.exit(1);
  }
  const vars: Record<string, string> = {};
  fs.readFileSync(filePath, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return;
      vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    });
  return vars;
}

const env = loadEnv(CREDS_FILE);
const N8N_BASE_URL = env.N8N_BASE_URL || "https://n8n.yielded.io";
const N8N_API_KEY = env.N8N_API_KEY || "";
const GMAIL_CRED = env.GMAIL_CREDENTIAL_NAME || "Gmail account";
const GCAL_CRED = env.GCAL_CREDENTIAL_NAME || "Google Calendar account";
const ANTHROPIC_CRED = env.ANTHROPIC_CREDENTIAL_NAME || "Anthropic account";
const DRY_RUN = process.env.DRY_RUN === "true";

if (!N8N_API_KEY) {
  console.error(`\n❌  N8N_API_KEY is empty in ${CREDS_FILE}`);
  console.error(`    Add your API key and re-run.\n`);
  process.exit(1);
}

// ── n8n REST helpers ───────────────────────────────────────────────────────
async function n8nRequest(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<unknown> {
  const url = `${N8N_BASE_URL}/api/v1${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n ${method} ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function getExistingWorkflows(): Promise<{ id: string; name: string }[]> {
  const data = (await n8nRequest("GET", "/workflows?limit=250")) as {
    data: { id: string; name: string }[];
  };
  return data.data || [];
}

// ── Credential ID resolution ───────────────────────────────────────────────
async function resolveCredentialId(name: string): Promise<string | null> {
  const data = (await n8nRequest("GET", "/credentials")) as {
    data: { id: string; name: string }[];
  };
  const cred = (data.data || []).find((c) => c.name === name);
  return cred?.id ?? null;
}

// ── Workflow patching (replace placeholder IDs) ───────────────────────────
function patchWorkflow(
  raw: string,
  credMap: Record<string, string>
): Record<string, unknown> {
  let patched = raw;
  for (const [placeholder, id] of Object.entries(credMap)) {
    patched = patched.split(placeholder).join(id);
  }
  return JSON.parse(patched);
}

// ── Deploy a single workflow ───────────────────────────────────────────────
async function deployWorkflow(
  filePath: string,
  credMap: Record<string, string>,
  existing: { id: string; name: string }[]
): Promise<void> {
  const raw = fs.readFileSync(filePath, "utf8");
  const workflow = patchWorkflow(raw, credMap);
  const name = workflow.name as string;

  const found = existing.find((w) => w.name === name);

  if (DRY_RUN) {
    console.log(`  [dry-run] Would ${found ? "update" : "create"}: ${name}`);
    return;
  }

  if (found) {
    await n8nRequest("PUT", `/workflows/${found.id}`, workflow);
    console.log(`  ✅  Updated: ${name}`);
  } else {
    await n8nRequest("POST", "/workflows", workflow);
    console.log(`  ✅  Created: ${name}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀  Ruflo Email Manager — n8n Deployer`);
  console.log(`    Instance : ${N8N_BASE_URL}`);
  console.log(`    Creds    : ${CREDS_FILE}`);
  console.log(`    Dry-run  : ${DRY_RUN}\n`);

  // Resolve credential IDs
  console.log("🔑  Resolving credentials...");
  const [gmailId, gcalId, anthropicId] = await Promise.all([
    resolveCredentialId(GMAIL_CRED),
    resolveCredentialId(GCAL_CRED),
    resolveCredentialId(ANTHROPIC_CRED),
  ]);

  if (!gmailId) console.warn(`  ⚠️   Gmail credential not found: "${GMAIL_CRED}"`);
  if (!gcalId) console.warn(`  ⚠️   Google Calendar credential not found: "${GCAL_CRED}"`);
  if (!anthropicId) console.warn(`  ⚠️   Anthropic credential not found: "${ANTHROPIC_CRED}"`);

  const credMap: Record<string, string> = {
    REPLACE_WITH_GMAIL_CREDENTIAL_ID: gmailId || "unknown",
    REPLACE_WITH_GCAL_CREDENTIAL_ID: gcalId || "unknown",
    REPLACE_WITH_ANTHROPIC_CREDENTIAL_ID: anthropicId || "unknown",
  };

  // Get existing workflows to support upsert
  console.log("\n📋  Fetching existing workflows...");
  const existing = DRY_RUN ? [] : await getExistingWorkflows();

  // Deploy all workflow files in order
  const workflowDir = path.join(__dirname, "workflows");
  const files = fs
    .readdirSync(workflowDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(workflowDir, f));

  console.log(`\n📦  Deploying ${files.length} workflows...\n`);
  for (const file of files) {
    try {
      await deployWorkflow(file, credMap, existing);
    } catch (err) {
      console.error(`  ❌  Failed: ${path.basename(file)} — ${(err as Error).message}`);
    }
  }

  console.log(`\n✨  Done! Open ${N8N_BASE_URL} to activate your workflows.\n`);
}

main().catch((err) => {
  console.error("\n❌  Fatal error:", err.message);
  process.exit(1);
});
