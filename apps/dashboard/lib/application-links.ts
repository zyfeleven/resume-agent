export const applicationTaskHref = (id: string) => `/agent/applications/${encodeURIComponent(id)}`;

/** Next runtimes can expose either encoded or decoded dynamic segments.
 * Prefer an exact stored ID; never repeatedly decode or infer a different task.
 */
export function resolveApplicationTaskId(tasks: readonly { id: string }[], segment: string): string | null {
  if (tasks.some((task) => task.id === segment)) return segment;
  try {
    const decoded = decodeURIComponent(segment);
    return tasks.some((task) => task.id === decoded) ? decoded : null;
  } catch {
    return null;
  }
}
