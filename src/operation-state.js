export const OPERATION_STATES = ["idle", "loading", "success", "offline", "conflict", "session_expired", "error"];

export function classifyOperationError(error, online = true) {
  if (!online || error?.code === "OFFLINE") return "offline";
  if ([401, 403].includes(error?.status) || ["PGRST301", "AUTH_SESSION_MISSING"].includes(error?.code)) return "session_expired";
  if (error?.status === 409 || ["23505", "VERSION_CONFLICT"].includes(error?.code)) return "conflict";
  return "error";
}

export class OperationController {
  constructor({ isOnline = () => globalThis.navigator?.onLine !== false } = {}) {
    this.isOnline = isOnline;
    this.state = { status: "idle", data: null, error: null, attempt: 0, canRetry: false };
    this.lastOperation = null;
  }

  snapshot() { return structuredClone(this.state); }

  async run(operation, { optimistic, rollback } = {}) {
    if (typeof operation !== "function") throw new TypeError("Operation must be a function");
    this.lastOperation = { operation, options: { optimistic, rollback } };
    const attempt = this.state.attempt + 1;
    if (!this.isOnline()) {
      this.state = { ...this.state, status: "offline", error: { message: "You appear to be offline." }, attempt, canRetry: true };
      return this.snapshot();
    }
    let rollbackValue;
    try {
      rollbackValue = optimistic?.();
      this.state = { ...this.state, status: "loading", error: null, attempt, canRetry: false };
      const data = await operation();
      this.state = { status: "success", data, error: null, attempt, canRetry: false };
    } catch (error) {
      rollback?.(rollbackValue);
      const status = classifyOperationError(error, this.isOnline());
      this.state = { ...this.state, status, error: { message: error?.message ?? "Operation failed", code: error?.code ?? null }, attempt, canRetry: !["conflict", "session_expired"].includes(status) };
    }
    return this.snapshot();
  }

  async retry() {
    if (!this.lastOperation || !this.state.canRetry) throw new Error("This operation cannot be retried");
    return this.run(this.lastOperation.operation, this.lastOperation.options);
  }

  reset() { this.state = { status: "idle", data: null, error: null, attempt: 0, canRetry: false }; this.lastOperation = null; return this.snapshot(); }
}
