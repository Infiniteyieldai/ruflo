/**
 * V3 MCP n8n Integration Tools
 *
 * MCP tools for n8n workflow automation with Claude:
 * - n8n/workflow/create  - Create a workflow from JSON
 * - n8n/workflow/list    - List all workflows
 * - n8n/workflow/get     - Get workflow by ID
 * - n8n/workflow/activate - Activate a workflow
 * - n8n/workflow/delete  - Delete a workflow
 * - n8n/credential/create - Create a credential in n8n
 * - n8n/credential/list  - List credentials
 * - n8n/env/read         - Read credentials from .env.shared
 * - n8n/env/update       - Write new credential to .env.shared
 *
 * Implements ADR-005: MCP-First API Design
 *
 * Usage: Claude reads the description, generates workflow JSON, then calls
 * n8n/workflow/create. Credentials are sourced from .env.shared.
 */

import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { MCPTool, ToolContext } from '../types.js';

// ============================================================================
// .env.shared helpers
// ============================================================================

const ENV_SHARED_PATH = resolve(process.cwd(), '.env.shared');

function readEnvShared(): Record<string, string> {
  if (!existsSync(ENV_SHARED_PATH)) {
    return {};
  }
  const raw = readFileSync(ENV_SHARED_PATH, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

function writeEnvShared(updates: Record<string, string>): void {
  let raw = existsSync(ENV_SHARED_PATH) ? readFileSync(ENV_SHARED_PATH, 'utf-8') : '';
  for (const [key, value] of Object.entries(updates)) {
    // Reject keys with unsafe characters
    if (!/^[A-Z0-9_]+$/.test(key)) {
      throw new Error(`Invalid env key: ${key}. Only uppercase letters, digits, and underscores allowed.`);
    }
    const escapedValue = value.includes(' ') ? `"${value}"` : value;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(raw)) {
      raw = raw.replace(pattern, `${key}=${escapedValue}`);
    } else {
      raw = raw.trimEnd() + `\n${key}=${escapedValue}\n`;
    }
  }
  writeFileSync(ENV_SHARED_PATH, raw, 'utf-8');
}

// ============================================================================
// n8n API client helper
// ============================================================================

interface N8nConfig {
  baseUrl: string;
  apiKey: string;
}

function getN8nConfig(): N8nConfig {
  const env = readEnvShared();
  const baseUrl =
    env['N8N_BASE_URL'] ||
    process.env['N8N_BASE_URL'] ||
    'http://localhost:5678';
  const apiKey =
    env['N8N_API_KEY'] ||
    process.env['N8N_API_KEY'] ||
    '';
  if (!apiKey) {
    throw new Error(
      'N8N_API_KEY is not set. Add it to .env.shared or the environment.'
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}

async function n8nRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const { baseUrl, apiKey } = getN8nConfig();
  const url = `${baseUrl}/api/v1${path}`;
  const headers: Record<string, string> = {
    'X-N8N-API-KEY': apiKey,
    'Content-Type': 'application/json',
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`n8n API error ${res.status}: ${text}`);
  }
  return data;
}

// ============================================================================
// Input Schemas
// ============================================================================

const workflowCreateSchema = z.object({
  name: z.string().min(1).max(128).describe('Human-readable workflow name'),
  nodes: z.array(z.record(z.unknown()))
    .describe('Array of n8n node objects'),
  connections: z.record(z.unknown())
    .describe('n8n connections map between nodes'),
  settings: z.record(z.unknown()).optional()
    .describe('Optional workflow settings (executionOrder, etc.)'),
  activate: z.boolean().default(false)
    .describe('Activate the workflow immediately after creation'),
});

const workflowListSchema = z.object({
  active: z.boolean().optional()
    .describe('Filter by active status'),
  limit: z.number().int().min(1).max(250).default(50)
    .describe('Maximum number of workflows to return'),
});

const workflowGetSchema = z.object({
  id: z.string().describe('Workflow ID'),
});

const workflowActivateSchema = z.object({
  id: z.string().describe('Workflow ID to activate or deactivate'),
  active: z.boolean().default(true)
    .describe('true = activate, false = deactivate'),
});

const workflowDeleteSchema = z.object({
  id: z.string().describe('Workflow ID to delete'),
});

const credentialCreateSchema = z.object({
  name: z.string().min(1).max(128)
    .describe('Credential name (must be unique in n8n)'),
  type: z.string().min(1)
    .describe('Credential type (e.g. httpHeaderAuth, postgresDb, slackApi)'),
  data: z.record(z.unknown())
    .describe('Credential data object — field names match n8n credential schema'),
  saveToEnv: z.boolean().default(false)
    .describe('Also save non-secret fields to .env.shared'),
  envPrefix: z.string().optional()
    .describe('Prefix for .env.shared keys when saveToEnv is true (e.g. SLACK)'),
});

const credentialListSchema = z.object({
  limit: z.number().int().min(1).max(250).default(50)
    .describe('Maximum number of credentials to return'),
});

const envReadSchema = z.object({
  keys: z.array(z.string()).optional()
    .describe('Specific keys to read. Omit to return all keys (secret values redacted).'),
});

const envUpdateSchema = z.object({
  updates: z.record(z.string())
    .describe('Key/value pairs to write to .env.shared. Keys must be UPPER_SNAKE_CASE.'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

export const createWorkflowTool: MCPTool = {
  name: 'n8n/workflow/create',
  description:
    'Create a new n8n workflow from a node/connection definition. ' +
    'Claude should generate the nodes and connections arrays based on the ' +
    'user description before calling this tool. ' +
    'Uses N8N_BASE_URL and N8N_API_KEY from .env.shared.',
  category: 'n8n',
  tags: ['n8n', 'workflow', 'create'],
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable workflow name' },
      nodes: {
        type: 'array',
        items: { type: 'object' },
        description: 'Array of n8n node objects',
      },
      connections: {
        type: 'object',
        description: 'n8n connections map',
      },
      settings: {
        type: 'object',
        description: 'Optional workflow settings',
      },
      activate: {
        type: 'boolean',
        description: 'Activate workflow immediately',
        default: false,
      },
    },
    required: ['name', 'nodes', 'connections'],
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const input = workflowCreateSchema.parse(params);
    const payload: Record<string, unknown> = {
      name: input.name,
      nodes: input.nodes,
      connections: input.connections,
    };
    if (input.settings) {
      payload['settings'] = input.settings;
    }
    const created = await n8nRequest('POST', '/workflows', payload) as Record<string, unknown>;
    if (input.activate && created['id']) {
      await n8nRequest('PATCH', `/workflows/${created['id']}/activate`);
    }
    return {
      success: true,
      workflow: {
        id: created['id'],
        name: created['name'],
        active: input.activate,
        createdAt: created['createdAt'],
      },
    };
  },
};

export const listWorkflowsTool: MCPTool = {
  name: 'n8n/workflow/list',
  description:
    'List n8n workflows. Optionally filter by active status. ' +
    'Uses N8N_BASE_URL and N8N_API_KEY from .env.shared.',
  category: 'n8n',
  tags: ['n8n', 'workflow', 'list'],
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      active: { type: 'boolean', description: 'Filter by active status' },
      limit: { type: 'number', description: 'Max results', default: 50 },
    },
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const input = workflowListSchema.parse(params);
    const qs = new URLSearchParams();
    qs.set('limit', String(input.limit));
    if (input.active !== undefined) {
      qs.set('active', String(input.active));
    }
    const data = await n8nRequest('GET', `/workflows?${qs}`) as Record<string, unknown>;
    const items = (data['data'] ?? data) as unknown[];
    return {
      success: true,
      count: Array.isArray(items) ? items.length : 0,
      workflows: items,
    };
  },
};

export const getWorkflowTool: MCPTool = {
  name: 'n8n/workflow/get',
  description: 'Get a single n8n workflow by ID.',
  category: 'n8n',
  tags: ['n8n', 'workflow'],
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Workflow ID' },
    },
    required: ['id'],
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const { id } = workflowGetSchema.parse(params);
    const data = await n8nRequest('GET', `/workflows/${encodeURIComponent(id)}`);
    return { success: true, workflow: data };
  },
};

export const activateWorkflowTool: MCPTool = {
  name: 'n8n/workflow/activate',
  description: 'Activate or deactivate an n8n workflow.',
  category: 'n8n',
  tags: ['n8n', 'workflow'],
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Workflow ID' },
      active: { type: 'boolean', default: true, description: 'true = activate' },
    },
    required: ['id'],
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const { id, active } = workflowActivateSchema.parse(params);
    const endpoint = active
      ? `/workflows/${encodeURIComponent(id)}/activate`
      : `/workflows/${encodeURIComponent(id)}/deactivate`;
    const data = await n8nRequest('PATCH', endpoint);
    return { success: true, workflow: data };
  },
};

export const deleteWorkflowTool: MCPTool = {
  name: 'n8n/workflow/delete',
  description: 'Delete an n8n workflow by ID.',
  category: 'n8n',
  tags: ['n8n', 'workflow'],
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Workflow ID' },
    },
    required: ['id'],
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const { id } = workflowDeleteSchema.parse(params);
    await n8nRequest('DELETE', `/workflows/${encodeURIComponent(id)}`);
    return { success: true, deleted: id };
  },
};

export const createCredentialTool: MCPTool = {
  name: 'n8n/credential/create',
  description:
    'Create a credential in n8n. The data field should match the n8n ' +
    'credential schema for the given type (e.g. httpHeaderAuth, slackApi). ' +
    'Optionally also persist non-secret fields to .env.shared.',
  category: 'n8n',
  tags: ['n8n', 'credential'],
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Credential name' },
      type: { type: 'string', description: 'Credential type' },
      data: { type: 'object', description: 'Credential data' },
      saveToEnv: { type: 'boolean', default: false },
      envPrefix: { type: 'string', description: 'Prefix for env keys' },
    },
    required: ['name', 'type', 'data'],
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const input = credentialCreateSchema.parse(params);
    const payload = {
      name: input.name,
      type: input.type,
      data: input.data,
    };
    const created = await n8nRequest('POST', '/credentials', payload) as Record<string, unknown>;

    if (input.saveToEnv && input.envPrefix) {
      const prefix = input.envPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const envUpdates: Record<string, string> = {};
      // Only save non-secret, string-valued fields
      for (const [k, v] of Object.entries(input.data)) {
        if (typeof v === 'string' && !/(secret|password|token|key)/i.test(k)) {
          envUpdates[`${prefix}_${k.toUpperCase()}`] = v;
        }
      }
      if (Object.keys(envUpdates).length > 0) {
        writeEnvShared(envUpdates);
      }
    }

    return {
      success: true,
      credential: {
        id: created['id'],
        name: created['name'],
        type: created['type'],
      },
    };
  },
};

export const listCredentialsTool: MCPTool = {
  name: 'n8n/credential/list',
  description:
    'List credentials stored in n8n. ' +
    'Secret values are never returned by the n8n API.',
  category: 'n8n',
  tags: ['n8n', 'credential'],
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', default: 50 },
    },
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const input = credentialListSchema.parse(params);
    const qs = new URLSearchParams({ limit: String(input.limit) });
    const data = await n8nRequest('GET', `/credentials?${qs}`) as Record<string, unknown>;
    const items = (data['data'] ?? data) as unknown[];
    return { success: true, count: Array.isArray(items) ? items.length : 0, credentials: items };
  },
};

export const readEnvTool: MCPTool = {
  name: 'n8n/env/read',
  description:
    'Read credentials and configuration from .env.shared. ' +
    'When no keys are specified, all keys are returned but secret-looking ' +
    'values (those whose key contains SECRET, KEY, TOKEN, or PASSWORD) ' +
    'are redacted to "***".',
  category: 'n8n',
  tags: ['n8n', 'credential', 'env'],
  cacheable: false,
  inputSchema: {
    type: 'object',
    properties: {
      keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific keys to read. Omit for all keys.',
      },
    },
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const input = envReadSchema.parse(params);
    const env = readEnvShared();

    if (input.keys && input.keys.length > 0) {
      const result: Record<string, string | null> = {};
      for (const key of input.keys) {
        result[key] = env[key] ?? null;
      }
      return { success: true, values: result };
    }

    // Return all but redact secrets
    const redacted: Record<string, string> = {};
    const secretPattern = /SECRET|KEY|TOKEN|PASSWORD/i;
    for (const [k, v] of Object.entries(env)) {
      redacted[k] = secretPattern.test(k) ? '***' : v;
    }
    return { success: true, values: redacted, note: 'Secret-looking values are redacted.' };
  },
};

export const updateEnvTool: MCPTool = {
  name: 'n8n/env/update',
  description:
    'Write new key/value pairs to .env.shared. ' +
    'Existing keys are overwritten; new keys are appended. ' +
    'Keys must be UPPER_SNAKE_CASE (A-Z, 0-9, _). ' +
    'Never pass actual secrets here unless the file is git-ignored.',
  category: 'n8n',
  tags: ['n8n', 'credential', 'env'],
  inputSchema: {
    type: 'object',
    properties: {
      updates: {
        type: 'object',
        description: 'Key/value pairs to write',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['updates'],
  },
  handler: async (params: Record<string, unknown>, _ctx?: ToolContext) => {
    const input = envUpdateSchema.parse(params);
    writeEnvShared(input.updates);
    return {
      success: true,
      written: Object.keys(input.updates),
      path: ENV_SHARED_PATH,
    };
  },
};

// ============================================================================
// Tool Group Export
// ============================================================================

export const n8nTools: MCPTool[] = [
  createWorkflowTool,
  listWorkflowsTool,
  getWorkflowTool,
  activateWorkflowTool,
  deleteWorkflowTool,
  createCredentialTool,
  listCredentialsTool,
  readEnvTool,
  updateEnvTool,
];

export default n8nTools;
