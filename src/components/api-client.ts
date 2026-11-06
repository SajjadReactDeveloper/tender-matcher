// fetch that throws a readable message for network failures and for the server's { error } replies.
export async function api(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('Cannot reach the app. Is it still running?');
  }
  if (!res.ok) {
    let message: string | undefined;
    try {
      message = ((await res.json()) as { error?: string }).error;
    } catch {
      /* not JSON */
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res;
}
