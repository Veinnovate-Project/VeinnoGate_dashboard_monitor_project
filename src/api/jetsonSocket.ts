export type SocketStatus = "CONNECTING" | "OPEN" | "RECONNECTING" | "CLOSED";

export interface JetsonSocketOptions {
  url: string;
  onMessage: (raw: unknown) => void;
  onStatusChange: (status: SocketStatus) => void;
  /** Injectable for tests; defaults to the platform WebSocket. */
  createSocket?: (url: string) => WebSocket;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Reconnecting WebSocket client with capped exponential backoff. A dropped
 * connection is surfaced immediately via onStatusChange("RECONNECTING") so
 * the UI can move to DEVICE_DISCONNECTED rather than silently freezing on
 * the last-known values.
 */
export class ReconnectingJetsonSocket {
  private socket: WebSocket | null = null;
  private closedByCaller = false;
  private backoffMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: JetsonSocketOptions) {
    this.minBackoffMs = options.minBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 15000;
    this.backoffMs = this.minBackoffMs;
  }

  connect(): void {
    this.closedByCaller = false;
    this.options.onStatusChange("CONNECTING");
    const create = this.options.createSocket ?? ((url: string) => new WebSocket(url));
    const socket = create(this.options.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.backoffMs = this.minBackoffMs;
      this.options.onStatusChange("OPEN");
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string);
        this.options.onMessage(parsed);
      } catch {
        this.options.onMessage({ __parse_error__: true, raw: event.data });
      }
    });

    socket.addEventListener("close", () => {
      if (this.closedByCaller) {
        this.options.onStatusChange("CLOSED");
        return;
      }
      this.options.onStatusChange("RECONNECTING");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
      this.connect();
    }, this.backoffMs);
  }

  close(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  }
}
