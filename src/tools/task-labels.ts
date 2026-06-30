/**
 * Task Labels Tool
 * Handles task label operations: apply-label, remove-label, list-labels
 *
 * apply/remove go through the Vikunja REST API DIRECTLY (using the session's apiUrl+token, like the
 * bucket tool) instead of the node-vikunja client: the client's label add/remove reported success
 * without actually changing the task's labels, which left statuses and labels out of sync. Direct
 * PUT/DELETE on /tasks/{id}/labels is the same path the web UI uses and is verified by re-reading
 * the task. list-labels stays a plain read.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { logger } from '../utils/logger';
import { createAuthRequiredError } from '../utils/error-handler';
import { createSuccessResponse, formatMcpResponse } from '../utils/simple-response';

interface TaskLabel {
  id: number;
  title: string;
  [key: string]: unknown;
}

/** Call the Vikunja REST API directly with the current session's credentials. */
async function vikunjaFetch(
  authManager: AuthManager,
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const { apiUrl, apiToken } = authManager.getSession();
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new MCPError(ErrorCode.API_ERROR, `Vikunja ${method} ${path} failed: HTTP ${res.status} ${detail}`);
  }
  return data;
}

/** Read a task's current labels (id+title) — used to confirm the result of apply/remove. */
async function readLabels(authManager: AuthManager, taskId: number): Promise<Array<{ id: number; title: string }>> {
  const task = (await vikunjaFetch(authManager, 'GET', `/tasks/${taskId}`)) as { labels?: TaskLabel[] };
  return (task.labels ?? []).map((l) => ({ id: l.id, title: l.title }));
}

/**
 * Register task labels tool
 */
export function registerTaskLabelsTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_task_labels',
    'Manage task labels: apply, remove, list labels',
    {
      operation: z.enum(['apply-label', 'remove-label', 'list-labels']),
      // Task and label identification
      id: z.number(),
      labels: z.array(z.number()).optional(),
    },
    async (args) => {
      try {
        logger.debug('Executing task labels tool', {
          operation: args.operation,
          taskId: args.id,
          labelCount: args.labels?.length,
        });

        if (!authManager.isAuthenticated()) {
          throw createAuthRequiredError('access task label operations');
        }

        switch (args.operation) {
          case 'apply-label': {
            if (!args.labels || args.labels.length === 0) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'At least one label id is required');
            }
            for (const labelId of args.labels) {
              await vikunjaFetch(authManager, 'PUT', `/tasks/${args.id}/labels`, { label_id: labelId });
            }
            const labels = await readLabels(authManager, args.id);
            return {
              content: formatMcpResponse(
                createSuccessResponse('apply-label', `Label(s) applied to task ${args.id}`, {
                  task: { id: args.id, labels },
                }),
              ),
            };
          }

          case 'remove-label': {
            if (!args.labels || args.labels.length === 0) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'At least one label id is required to remove');
            }
            for (const labelId of args.labels) {
              await vikunjaFetch(authManager, 'DELETE', `/tasks/${args.id}/labels/${labelId}`);
            }
            const labels = await readLabels(authManager, args.id);
            return {
              content: formatMcpResponse(
                createSuccessResponse('remove-label', `Label(s) removed from task ${args.id}`, {
                  task: { id: args.id, labels },
                }),
              ),
            };
          }

          case 'list-labels': {
            const labels = await readLabels(authManager, args.id);
            return {
              content: formatMcpResponse(
                createSuccessResponse('list-labels', `Task ${args.id} has ${labels.length} label(s)`, {
                  task: { id: args.id, labels },
                }),
              ),
            };
          }

          default:
            throw new MCPError(ErrorCode.VALIDATION_ERROR, `Unknown operation: ${String(args.operation)}`);
        }
      } catch (error) {
        if (error instanceof MCPError) {
          throw error;
        }
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `Task label operation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
