/**
 * Kanban Bucket Tool
 *
 * Adds the one capability node-vikunja / the base MCP do not expose: moving a task
 * between kanban buckets (columns / statuses) on a project VIEW. Vikunja stores bucket
 * membership per-view and exposes it only through the views-based endpoints, which the
 * bundled node-vikunja client (v0.4.x) does not wrap — so this tool calls the REST API
 * directly using the session's apiUrl + token.
 *
 * Endpoints used:
 *   GET  /projects/{project}/views                              -> list views
 *   GET  /projects/{project}/views/{view}/buckets               -> list buckets (columns)
 *   POST /projects/{project}/views/{view}/buckets/{bucket}/tasks -> move a task to a bucket
 *        body: { task_id, position? }
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import { MCPError, ErrorCode } from '../types';
import { logger } from '../utils/logger';
import { createAuthRequiredError } from '../utils/error-handler';
import { createSuccessResponse, formatMcpResponse } from '../utils/simple-response';

/**
 * Call the Vikunja REST API directly with the current session's credentials.
 */
async function vikunjaFetch(
  authManager: AuthManager,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const { apiUrl, apiToken } = authManager.getSession();
  const url = `${apiUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
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

interface NamedRow {
  id: number;
  title: string;
  [key: string]: unknown;
}

function toItems(rows: unknown): Array<{ id: number; title: string }> {
  if (!Array.isArray(rows)) return [];
  return (rows as NamedRow[]).map((r) => ({ id: r.id, title: r.title }));
}

// Like toItems, but also surfaces each bucket's TASKS. Vikunja's kanban /buckets endpoint embeds the
// tasks per bucket; the plain toItems dropped them, leaving callers unable to see what's in a column
// (e.g. which tasks are in "Ready"). Include id+title per task so the board is readable.
function toBucketsWithTasks(
  rows: unknown,
): Array<{ id: number; title: string; tasks: Array<{ id: number; title: string }> }> {
  if (!Array.isArray(rows)) return [];
  return (rows as Array<NamedRow & { tasks?: unknown }>).map((r) => ({
    id: r.id,
    title: r.title,
    tasks: toItems(r.tasks),
  }));
}

/**
 * Register the kanban bucket tool.
 */
export function registerBucketTool(server: McpServer, authManager: AuthManager): void {
  server.tool(
    'vikunja_bucket',
    'Kanban buckets (columns/statuses): list a project\'s views, list a view\'s buckets, and MOVE a task into a bucket. Use this to move a task between kanban columns, e.g. Backlog -> Review -> Done.',
    {
      operation: z.enum(['list-views', 'list-buckets', 'move-task']),
      projectId: z.number(),
      // required for list-buckets and move-task
      viewId: z.number().optional(),
      // required for move-task
      bucketId: z.number().optional(),
      taskId: z.number().optional(),
      // optional ordering within the target bucket
      position: z.number().optional(),
    },
    async (args) => {
      try {
        logger.debug('Executing bucket tool', { operation: args.operation, projectId: args.projectId });

        if (!authManager.isAuthenticated()) {
          throw createAuthRequiredError('access kanban bucket operations');
        }

        switch (args.operation) {
          case 'list-views': {
            const views = await vikunjaFetch(authManager, 'GET', `/projects/${args.projectId}/views`);
            return {
              content: formatMcpResponse(
                createSuccessResponse('list-views', `Views for project ${args.projectId}`, {
                  items: toItems(views),
                }),
              ),
            };
          }

          case 'list-buckets': {
            if (args.viewId === undefined) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'viewId is required for list-buckets');
            }
            const buckets = await vikunjaFetch(
              authManager,
              'GET',
              `/projects/${args.projectId}/views/${args.viewId}/buckets`,
            );
            return {
              content: formatMcpResponse(
                createSuccessResponse('list-buckets', `Buckets for project ${args.projectId} view ${args.viewId}`, {
                  items: toBucketsWithTasks(buckets),
                }),
              ),
            };
          }

          case 'move-task': {
            if (args.viewId === undefined || args.bucketId === undefined || args.taskId === undefined) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'viewId, bucketId and taskId are required for move-task',
              );
            }
            const body: Record<string, unknown> = { task_id: args.taskId };
            if (args.position !== undefined) {
              body.position = args.position;
            }
            await vikunjaFetch(
              authManager,
              'POST',
              `/projects/${args.projectId}/views/${args.viewId}/buckets/${args.bucketId}/tasks`,
              body,
            );
            return {
              content: formatMcpResponse(
                createSuccessResponse(
                  'move-task',
                  `Moved task ${args.taskId} to bucket ${args.bucketId} (project ${args.projectId}, view ${args.viewId})`,
                ),
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
          `Bucket operation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
