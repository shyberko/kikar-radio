export class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "PipelineError";
  }
}

export function mapHttp(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body || {});
  if (status === 401 || status === 403) return "auth";
  if (/storage|quota|disk|out of available space|full/i.test(text)) return "storage";
  if (status === 404) return "playlist";
  if (status === 408 || status === 504) return "timeout";
  return "unknown";
}

export function asPipeline(err) {
  if (err instanceof PipelineError) return err;
  const name = err?.name || "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new PipelineError("timeout", "timeout");
  }
  return new PipelineError("unknown", String(err?.message || err).slice(0, 300));
}
