/** Small helpers shared by handlers for reading loosely-typed API responses. */

export const nowIso = (): string => new Date().toISOString();

export const asNum = (v: unknown): number => (typeof v === "number" ? v : 0);

export const asCount = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
