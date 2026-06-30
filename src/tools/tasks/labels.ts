/**
 * Label operations for tasks (used by the vikunja_tasks tool's apply-label / remove-label).
 *
 * apply/remove call the Vikunja REST API DIRECTLY (session apiUrl+token, like the bucket tool and
 * vikunja_task_labels) instead of node-vikunja, whose label add/remove reported success without
 * changing the task — leaving statuses and labels out of sync. Verified by re-reading the task.
 */

import { MCPError, ErrorCode } from '../../types';
import type { AuthManager } from '../../auth/AuthManager';
import { getClientFromContext } from '../../client';
import { validateId } from './validation';
import { createSimpleResponse, formatAorpAsMarkdown } from '../../utils/response-factory';

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

async function readLabels(authManager: AuthManager, taskId: number): Promise<Array<{ id: number; title: string }>> {
  const task = (await vikunjaFetch(authManager, 'GET', `/tasks/${taskId}`)) as { labels?: TaskLabel[] };
  return (task.labels ?? []).map((l) => ({ id: l.id, title: l.title }));
}

/**
 * Add labels to a task (direct REST: PUT /tasks/{id}/labels).
 */
export async function applyLabels(
  authManager: AuthManager,
  args: { id?: number; labels?: number[] },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    if (!args.id) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task id is required for apply-label operation');
    }
    validateId(args.id, 'id');
    if (!args.labels || args.labels.length === 0) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'At least one label id is required');
    }
    args.labels.forEach((id) => validateId(id, 'label ID'));

    for (const labelId of args.labels) {
      await vikunjaFetch(authManager, 'PUT', `/tasks/${args.id}/labels`, { label_id: labelId });
    }
    const labels = await readLabels(authManager, args.id);
    const response = createSimpleResponse(
      'apply-label',
      `Label${args.labels.length > 1 ? 's' : ''} applied to task successfully`,
      { task: { id: args.id, labels } },
      { metadata: { affectedFields: ['labels'] } },
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    if (error instanceof MCPError) throw error;
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to apply labels to task: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Remove labels from a task (direct REST: DELETE /tasks/{id}/labels/{labelId}).
 */
export async function removeLabels(
  authManager: AuthManager,
  args: { id?: number; labels?: number[] },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    if (!args.id) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task id is required for remove-label operation');
    }
    validateId(args.id, 'id');
    if (!args.labels || args.labels.length === 0) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'At least one label id is required to remove');
    }
    args.labels.forEach((id) => validateId(id, 'label ID'));

    for (const labelId of args.labels) {
      await vikunjaFetch(authManager, 'DELETE', `/tasks/${args.id}/labels/${labelId}`);
    }
    const labels = await readLabels(authManager, args.id);
    const response = createSimpleResponse(
      'remove-label',
      `Label${args.labels.length > 1 ? 's' : ''} removed from task successfully`,
      { task: { id: args.id, labels } },
      { metadata: { affectedFields: ['labels'] } },
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    if (error instanceof MCPError) throw error;
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to remove labels from task: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * List labels of a task (read path — getTask works fine for reads).
 */
export async function listTaskLabels(args: {
  id?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    if (args.id === undefined) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task id is required for list-labels operation');
    }
    validateId(args.id, 'id');
    const client = await getClientFromContext();
    const task = await client.tasks.getTask(args.id);
    const labels = task.labels || [];
    const response = createSimpleResponse(
      'list-labels',
      `Task has ${labels.length} label(s)`,
      { task: { id: task.id, title: task.title, labels } },
      { metadata: { count: labels.length } },
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    if (error instanceof MCPError) throw error;
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to list task labels: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
