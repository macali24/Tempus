export type RetryOptions = {
  signal?: AbortSignal;
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type LookupStatus = 'found' | 'empty' | 'error';

export type BulkLookup<T> = {
  records: Record<string, T>;
  /** One terminal status for every requested key. */
  status: Record<string, LookupStatus>;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Request aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const header = response?.headers.get('Retry-After');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(10_000, Math.max(0, date - Date.now()));
  }
  const base = 250 * 2 ** attempt;
  return base + Math.round(Math.random() * Math.min(250, base / 2));
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', aborted, { once: true });

    function done() {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }

    function aborted() {
      clearTimeout(timer);
      reject(abortReason(signal!));
    }
  });
}

/**
 * Fetch with a real per-attempt timeout and conservative retries.
 * Parent cancellation always wins and is never retried.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = options.signal ?? init.signal ?? undefined;
  const retries = Math.max(0, options.retries ?? 2);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 12_000);

  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(signal);
    const controller = new AbortController();
    let timedOut = false;
    const parentAbort = () => controller.abort(abortReason(signal!));
    signal?.addEventListener('abort', parentAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, timeoutMs);

    let retryResponse: Response | undefined;
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) return response;
      retryResponse = response;
    } catch (error) {
      throwIfAborted(signal);
      if (attempt === retries) throw error;
      if (!timedOut && error instanceof DOMException && error.name === 'AbortError') throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', parentAbort);
    }

    await wait(retryDelay(retryResponse, attempt), signal);
  }

  throw new Error('Request retry loop ended unexpectedly.');
}

/** Run every item once without creating an unbounded request burst. */
export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      throwIfAborted(signal);
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  throwIfAborted(signal);
  return results;
}

export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const width = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += width) {
    chunks.push(items.slice(index, index + width));
  }
  return chunks;
}
