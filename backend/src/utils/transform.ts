/** Convert snake_case keys to camelCase recursively */
export function toCC(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toCC);
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        toCC(v),
      ])
    );
  }
  return obj;
}
