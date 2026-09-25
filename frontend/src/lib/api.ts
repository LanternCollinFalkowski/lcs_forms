const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

/**
 * Called once when the server says the caller is no longer authenticated.
 *
 * Sessions last seven days and the server re-reads permissions on every
 * request, so a session can lapse — or an admin can revoke access — in the
 * middle of somebody's afternoon. AuthProvider only asked once, at mount, so
 * the shell went on rendering them as signed in while every request 401'd:
 * an app that looks fine and does nothing. Registered by AuthProvider.
 */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(fn: (() => void) | null) {
  onSessionLost = fn;
}

/** Endpoints where a 401 is an answer, not a surprise. */
function expectsUnauthenticated(path: string) {
  return path.startsWith("/auth/me") || path.startsWith("/auth/logout");
}

function noteUnauthorized(path: string) {
  if (expectsUnauthenticated(path)) return;
  onSessionLost?.();
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  /** Server-side reference for a 500, to quote when reporting it. */
  requestId?: string;
  constructor(status: number, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let payload: any = undefined;
    try {
      payload = await res.json();
    } catch {
      // ignore
    }
    if (res.status === 401) noteUnauthorized(path);
    // requestId comes back on server faults — carried so the message can quote
    // something the logs can be searched for.
    throw new ApiError(res.status, payload?.error ?? res.statusText, payload?.details, payload?.requestId);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  /** Body is optional — used where a delete needs a decision, e.g. "move these people to…". */
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),

  /** Upload files (multipart). */
  upload: async <T>(path: string, formData: FormData) => request<T>("POST", path, formData),

  /** Download a file (e.g. CSV export) and trigger a browser save. */
  download: async (path: string, body: unknown, fallbackName: string) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let payload: any;
      try {
        payload = await res.json();
      } catch {}
      if (res.status === 401) noteUnauthorized(path);
      throw new ApiError(res.status, payload?.error ?? res.statusText, payload?.details, payload?.requestId);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const name = match?.[1] ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return { batchId: res.headers.get("x-export-batch-id") };
  },
};

export { BASE as API_BASE };
