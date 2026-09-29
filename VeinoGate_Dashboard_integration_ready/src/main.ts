import { loadRuntimeConfig, RuntimeConfigError } from "./config/runtimeConfig";
import { JetsonApiClient } from "./api/jetsonClient";
import { IdentityApiClient } from "./api/identityClient";
import { ReconnectingJetsonSocket, type SocketStatus } from "./api/jetsonSocket";
import { MultiSessionStore, tileMetaFromAssignment } from "./state/multiSessionStore";
import { ShiftStore } from "./state/shiftStore";
import { renderTileGrid, acknowledgeAlert, setDischargeStatus } from "./components/TileGridView";
import { IntakeModalController } from "./components/IntakeModalView";
import type { AlertTier } from "./state/alerts";
import { HeaderController } from "./components/HeaderView";
import type { Locale } from "./i18n/strings";

// Production entry point. Deliberately does not import anything from src/demo/**.
// If the backend or runtime config is unavailable, this must fail visibly --
// never fall back to synthetic data.

const headerEl = document.getElementById("header")!;
const appEl = document.getElementById("app")!;
const intakeEl = document.getElementById("intake-modals");
let socketStatus: SocketStatus = "CONNECTING";
let locale: Locale = "en";

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

  const store = new MultiSessionStore(config.stale_after_seconds);
  const shiftStore = new ShiftStore();
  const apiClient = new JetsonApiClient(config);
  const identityClient = new IdentityApiClient(config);

  // Adapter-first intake: one modal card per READY adapter; a successful
  // assignment adds its tile immediately, before the first reading arrives.
  let intakeController: IntakeModalController | null = null;
  if (intakeEl) {
    intakeController = new IntakeModalController(
      intakeEl,
      identityClient,
      (result) => store.addSession(result.session.session_id, tileMetaFromAssignment(result.assignment)),
      locale
    );
    intakeController.start();
  }

  const rerender = () => {
    appEl.innerHTML = renderTileGrid(store.getTiles(), locale, socketStatus);
  };

  store.subscribe((tiles) => {
    appEl.innerHTML = renderTileGrid(tiles, locale, socketStatus);
  });

  // Tile-grid actions (discharge, acknowledge) are delegated from one
  // listener on #app rather than a per-tile controller, matching the
  // read-mostly, backend-owned nature of the grid: every discharge still
  // goes through the fail-closed /v1/identity/sessions/{id}/end gate.
  appEl.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!target) return;
    const sessionId = target.dataset.sessionId;
    if (!sessionId) return;
    if (target.dataset.action === "discharge-tile") {
      // Instant "Discharging…" feedback; the tile itself is only removed once
      // the backend confirms, since end-session can be rejected fail-closed.
      setDischargeStatus(sessionId, "pending");
      rerender();
      void identityClient
        .endSession(sessionId)
        .then(() => {
          setDischargeStatus(sessionId, null);
          store.removeSession(sessionId);
        })
        .catch(() => {
          setDischargeStatus(sessionId, "failed");
          rerender();
        });
    } else if (target.dataset.action === "acknowledge") {
      acknowledgeAlert(sessionId, target.dataset.tier as AlertTier);
      rerender();
    }
  });

  async function syncNow(): Promise<void> {
    const snapshot = await apiClient.fetchSnapshot("current");
    store.ingest(snapshot);
  }

  const header = new HeaderController(
    headerEl,
    syncNow,
    (newLocale) => {
      locale = newLocale;
      intakeController?.setLocale(newLocale);
      rerender();
    },
    locale,
    (chargeNurse, shiftKey) => shiftStore.setShift(chargeNurse, shiftKey)
  );
  shiftStore.subscribe((shift) => header.setShift(shift));

  // Reload recovery: re-create tiles (with name/bed/department) for every
  // active session. Best-effort -- the vitals stream still creates tiles.
  void identityClient
    .listActiveSessions()
    .then(({ sessions }) => sessions.forEach((r) => store.addSession(r.session.session_id, tileMetaFromAssignment(r.assignment))))
    .catch(() => {});

  try {
    await syncNow();
  } catch {
    // No snapshot yet is not fatal -- the socket may still deliver the first reading.
  }

  const socket = new ReconnectingJetsonSocket({
    url: config.jetson_websocket_url,
    onMessage: (raw) => store.ingest(raw),
    onStatusChange: (status) => {
      socketStatus = status;
      store.setTransportStatus(status);
    }
  });
  socket.connect();

  setInterval(() => store.tick(), 1000);
}

main();
