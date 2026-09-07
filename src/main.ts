import { loadRuntimeConfig, RuntimeConfigError } from "./config/runtimeConfig";
import { JetsonApiClient } from "./api/jetsonClient";
import { IdentityApiClient } from "./api/identityClient";
import { ReconnectingJetsonSocket, type SocketStatus } from "./api/jetsonSocket";
import { VitalsStore } from "./state/store";
import { renderDashboard } from "./components/DashboardView";
import { AdapterPairingController } from "./components/AdapterPairingView";

// Production entry point. Deliberately does not import anything from src/demo/**.
// If the backend or runtime config is unavailable, this must fail visibly --
// never fall back to synthetic data.

const appEl = document.getElementById("app")!;
const pairingEl = document.getElementById("adapter-pairing");
let socketStatus: SocketStatus = "CONNECTING";

function renderFatalError(message: string): void {
  appEl.innerHTML = `<div class="vn-panel"><span class="vn-badge vn-badge--danger">Dashboard unavailable</span><div class="vn-error">${message}</div></div>`;
}

async function main(): Promise<void> {
  let config;
  try {
    config = await loadRuntimeConfig();
  } catch (err) {
    const message = err instanceof RuntimeConfigError ? err.message : String(err);
    renderFatalError(message);
    return;
  }

  const store = new VitalsStore(config.stale_after_seconds);
  const apiClient = new JetsonApiClient(config);

  if (pairingEl) {
    // Software-only POC pairing flow (AGENTS.md item 6) — an independent
    // panel that never touches VitalsStore/renderDashboard's rendering
    // path, so a failure here can never affect the vitals display above it.
    new AdapterPairingController(pairingEl, new IdentityApiClient(config), "he");
  }

  store.subscribe((state) => {
    appEl.innerHTML = renderDashboard(state, "en", socketStatus);
  });

  try {
    const snapshot = await apiClient.fetchSnapshot("current");
    store.ingest(snapshot);
  } catch {
    // No snapshot yet is not fatal -- the socket may still deliver the first reading.
  }

  const socket = new ReconnectingJetsonSocket({
    url: config.jetson_websocket_url,
    onMessage: (raw) => store.ingest(raw),
    onStatusChange: (status) => {
      socketStatus = status;
      store.setTransportStatus(status);
      appEl.innerHTML = renderDashboard(store.getState(), "en", socketStatus);
    }
  });
  socket.connect();

  setInterval(() => store.tick(), 1000);
}

main();
