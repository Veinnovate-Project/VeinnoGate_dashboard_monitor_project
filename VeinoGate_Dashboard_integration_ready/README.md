# VeinoGate Dashboard — Integration-Ready Bundle

A minimal, self-contained dashboard that displays vitals and blood-pressure
results produced by the Jetson edge service. This bundle talks **only** to
the Jetson's REST/WebSocket API. It never touches BLE directly, never loads
the ONNX inference model, and never performs signal preprocessing — the
Jetson is authoritative for inference, calibration, SQI, timestamps and
provenance.

This bundle is designed to sit alongside sibling bundles in the final
layout:

```text
Veinnovate_Prototype/
├── VeinNet_integration_ready/
├── Hardware_integration_ready/
└── VeinoGate_Dashboard_integration_ready/   <- this bundle
```

It assumes no absolute path to any sibling and can be copied out on its own
(see "Portability test" below).

## 1. Setup

This bundle ships **source only** — no `node_modules/`, no build output. Install before doing anything else:

```bash
npm ci
```

`npm ci` installs exactly what `package-lock.json` records — dependency
versions are locked. (`npm install` also works but `npm ci` is preferred for
a fresh checkout.)

## 2. Configuration

The dashboard fetches a deploy-time, non-secret JSON configuration file at
startup — it does not read build-time environment variables and nothing
about a real Jetson deployment is compiled into the JavaScript bundle.

**No `runtime-config.json` ships in this bundle.** That is intentional: a
committed one would risk Vite copying test/localhost settings straight into
a production build. The final integration engineer must create it
deliberately:

1. Copy the template:
   ```bash
   cp config/runtime-config.example.json assets/runtime-config.json
   ```
2. Edit only the deployment-specific, non-secret fields:

   | Field | Meaning |
   |---|---|
   | `config_schema_version` | Must be a version this build supports (currently `"1.0.0"`). |
   | `mode` | `"production"` or `"test"`. Only relaxes the `http`/`ws` scheme check for `localhost` in `"test"` mode — it never switches the app into demo mode (see §5). |
   | `jetson_rest_base_url` | Jetson REST base, e.g. `https://jetson.example.invalid/api/v1`. Must be `https://` outside `mode:"test"` + localhost. |
   | `jetson_websocket_url` | Jetson WebSocket URL. Must be `wss://` outside `mode:"test"` + localhost. |
   | `expected_result_schema_version` | Result schema version this deployment's Jetson emits. |
   | `connection_timeout_ms` | REST request timeout. |
   | `stale_after_seconds` | Client-side display staleness budget — independent of clinical calibration thresholds, which always come from the Jetson's own `calibration` object on every message. |

Never commit a `runtime-config.json` containing a real deployment's host,
port, or any identifier into this bundle — it is `.gitignore`d for exactly
that reason. For local development or manual testing against the bundled
mock server (§7), copy `tests/mockServer/runtime-config.test.json` to
`assets/runtime-config.json` instead — that file is committed under
`tests/` precisely because it is understood to be test-only and is never
picked up by the production build path unless someone explicitly places a
copy under `assets/` (Vite's `publicDir`).

**Startup fails visibly** — a fatal error panel, no fallback — if
`runtime-config.json` is absent, fails schema validation, names an
unsupported `config_schema_version`, or uses an insecure URL scheme outside
test/localhost. See `src/config/runtimeConfig.ts`. This is deliberate: a
`npm run build` with no `assets/runtime-config.json` in place produces a
`dist/` that fails visibly at runtime rather than silently shipping a stale
or test configuration.

No API tokens or credentials belong in this file or anywhere in this
bundle; it carries no authentication material.

## 3. Execution

Production and demo are **separate build/dev commands and separate HTML
entry points** — there is no runtime flag that switches between them, and no
failure path (network, parsing, backend error) can make one become the
other.

| Command | Entry point | Behavior |
|---|---|---|
| `npm run dev` | `index.html` → `src/main.ts` | Production dev server. Talks only to the configured Jetson API/WebSocket. |
| `npm run build` | `index.html` | Production build → `dist/`. |
| `npm run dev:demo` | `demo.html` → `src/main.demo.ts` | Demo dev server. Synthetic data only, permanent `DEMO — SYNTHETIC DATA` banner baked into `demo.html`. |
| `npm run build:demo` | `demo.html` | Demo build → `dist-demo/`. |
| `npm run mock-server` | — | Starts the test-only mock Jetson server on `:8787` (see §7). Never started by any build/dev/production command. |
| `npm run preview` | — | Serves a built `dist/` for a final local smoke test. |

`src/main.ts` (production) never imports anything from `src/demo/`, and
`Math.random()` exists nowhere outside `src/demo/demoDataSource.ts` —
enforced by `tests/demoIsolation.test.ts` and, after a production build, by
`npm run check:no-random-in-prod`.

## 4. API / WebSocket contract summary

Canonical field names (`schema_version`, `message_type`, `result_state`,
`reading_id`, `session_id`, `patient_id`, `device_id`,
`acquisition_start_utc`, `acquisition_end_utc`, `emitted_at_utc`, …) are
defined once in `schemas/jetson-result.schema.json` and
`schemas/jetson-ws-envelope.schema.json`, and enforced at runtime by
`src/state/validateResult.ts` (via ajv). TypeScript types mirroring the
schema live in `src/state/resultTypes.ts`.

**This bundle is the schema consumer, not the producer.** The producer of
record is `Hardware_integration_ready`. Two drift-check commands compare
this bundle's schema files byte-for-byte against
`../Hardware_integration_ready/schemas/*.json` (a relative sibling path,
never assumed to exist, never an absolute path):

- `npm run check:schema-drift` — optional mode. Exits 0 with a "SKIPPED"
  message when the sibling isn't present yet, e.g. during the standalone
  portability test where this bundle is copied alone.
- `npm run check:schema-drift:strict` — required for the final
  three-component acceptance test once `Hardware_integration_ready` exists
  alongside this bundle. Fails if the sibling is missing, if any producer
  schema file is missing, or on any hash mismatch. Only an exact byte match
  passes.

Five canonical top-level `result_state` values, one authoritative per
message:

```
VALID | ABSTAIN | RECALIBRATE | INFERENCE_ERROR | DEVICE_DISCONNECTED
```

Every message additionally carries `bp` (SBP/DBP in mmHg, `null` unless
`VALID`), `hr` (bpm, nullable), `spo2` (see §6), `calibration` (status, id,
timestamp, age, and both the warning and expiry thresholds — supplied by the
Jetson, never hardcoded here), `sqi` (accepted flag + a versioned
reason-code array + signal metrics), `provenance` (model/ONNX/preprocessing/
morphology/SQI/calibration-protocol/BLE-protocol/sensor-config versions),
`connection` (status + data age), and the three UTC timestamps above for
ordering and staleness.

Schema-enforced rules: `VALID` requires finite `sbp_mmhg`/`dbp_mmhg`; every
other state requires them `null`; `RECALIBRATE` requires a calibration
`status`/`reason`; `ABSTAIN` requires at least one SQI reason code. An
unsupported `schema_version` or an unrecognized `result_state` renders a
safe unsupported/error state (`UNSUPPORTED_SCHEMA` / `UNSUPPORTED_STATE`) —
it never crashes and never guesses at values.

`Claude_Implementation_Order_VeinnoGate_VeinNet_Sync.md` in the source
repository was used as **historical input only** — some of its assumptions
(e.g. SpO₂ pass-through, and field names like `adapter_id`/`sensor_session_id`/
`window_started_at`) are superseded by the canonical names and SpO₂
correction documented here and must not be treated as the final contract.

### Backend states

| Backend `result_state` | Dashboard shows |
|---|---|
| `VALID` | Current SBP/DBP, HR, SpO₂ (if available), calibration badge. |
| `ABSTAIN` | "BP unavailable — insufficient signal quality" + SQI reason code(s). Previous valid reading may remain, marked historical. |
| `RECALIBRATE` | "BP unavailable — recalibration required" + calibration reason. New BP is suppressed even if the calibration state elsewhere looks fine. |
| `INFERENCE_ERROR` | "Inference unavailable" — no invented values. |
| `DEVICE_DISCONNECTED` (or `connection.status: "DISCONNECTED"`) | Connection-loss message + data age. |
| Anything else / unsupported version | Safe unsupported-state message; no values rendered. |

Internal richer states (`STALE`, `UNSUPPORTED_SCHEMA`,
`AWAITING_FIRST_READING`) are deterministic derivations computed in
`src/state/deriveUiState.ts` — they never introduce a second, competing
clinical judgment.

### Transport loss vs. backend-reported disconnection

Two independent signals can produce `DEVICE_DISCONNECTED`:

1. **The backend says so** — a message's `result_state` is
   `DEVICE_DISCONNECTED` or its `connection.status` is `DISCONNECTED`. This
   remains authoritative whenever it arrives.
2. **The WebSocket transport itself drops** — `ReconnectingJetsonSocket`
   reports `RECONNECTING` or `CLOSED`. `VitalsStore.setTransportStatus()`
   reacts immediately: it clears the current reading (not just the display
   label) and forces `DEVICE_DISCONNECTED`, so a previously `VALID` BP stops
   being shown as current **the instant the socket drops** — it does not
   wait for the staleness timer. The last known value survives only as
   `previousValid`. Reopening the socket (`OPEN`) does not by itself
   resurrect the old reading as current; the display stays
   `DEVICE_DISCONNECTED` until a fresh, validated message is actually
   ingested. See `tests/transportDisconnect.test.ts` for OPEN→RECONNECTING→OPEN
   and OPEN→CLOSED coverage.

## 5. Production vs. demo

- **Production** (`index.html`/`src/main.ts`): fetches `runtime-config.json`,
  opens the reconnecting WebSocket, validates and displays only what the
  Jetson sends. Any failure (missing config, malformed config, unreachable
  backend) renders a visible error — it never falls back to synthetic data.
- **Demo** (`demo.html`/`src/main.demo.ts`): runs entirely offline against
  `src/demo/demoDataSource.ts`, the only file in the bundle allowed to call
  `Math.random()`. The `DEMO — SYNTHETIC DATA` banner is static markup in
  `demo.html`, not a conditionally rendered component, so it cannot be
  built or shipped without it.
- The two are wired through separate Vite entry points
  (`vite.config.ts` picks `index.html` or `demo.html` via the
  `BUNDLE_TARGET` **build-tool** environment variable — a Node-side build
  selection, never a value read by the shipped browser code).

## 6. SpO₂

The MAX30102 sensor supplies raw RED/IR signal only, not a ready
percentage. Until the backend reports a result from an explicitly
versioned, validated SpO₂ algorithm, `spo2.pct` must be `null` and
`spo2.status` must be `"UNAVAILABLE"` — the dashboard displays
**"Unavailable"**, never a synthetic or estimated value, and never claims
SpO₂ arrives "as-is" from the sensor. If a future backend does supply a
valid SpO₂ result, the schema requires `algorithm_name` and
`algorithm_version` to accompany it (`spo2.status: "VALID"`); the dashboard
enforces that pairing and will reject a message that has one without the
other.

## 7. Tests

```bash
npm run typecheck
npm test
```

76 tests across 11 files, all passing at the time of writing:

- `tests/messages.test.ts` — valid and malformed/invalid message acceptance and rejection.
- `tests/messageGuard.test.ts` — duplicate rejection and out-of-order/delayed-reading rejection.
- `tests/store.test.ts` — end-to-end store behavior: VALID display, ABSTAIN/RECALIBRATE never fabricating BP, previous-valid retention, staleness, disconnection, unsupported schema version.
- `tests/transportDisconnect.test.ts` — WebSocket transport loss (OPEN→RECONNECTING→OPEN, OPEN→CLOSED) fails safe immediately, independent of the staleness timer; backend-reported `DEVICE_DISCONNECTED` stays authoritative.
- `tests/calibrationBoundaries.test.ts` — just-before/exactly-at/just-after both the warning and expiry boundaries, using thresholds taken from the message (not a local constant).
- `tests/spo2.test.ts` — SpO₂ unavailable-by-default and the VALID+algorithm-provenance pairing rule.
- `tests/runtimeConfig.test.ts` — missing/malformed config, unsupported config schema version, insecure-URL rejection, and the test-mode/localhost exception.
- `tests/demoIsolation.test.ts` — static checks that production never imports demo code and that the demo banner is unconditional markup.
- `tests/identityClient.test.ts` — identity API client (contract 1.1.0): base-URL derivation, live list, pairing start with profile, assignment success/409 rejection, session end.
- `tests/intakeModal.test.ts` — adapter-first intake card: one card per READY adapter, required fields and code confirmation, backend rejection (e.g. national-ID check digit), 10 s undo.
- `tests/stage17Grid.test.ts` — multi-session tile grid: partial NEWS2, alert tiers and acknowledgement, per-session demux, discharge states, tiles from assignment events.

`tests/mockServer/` contains a lightweight, test/demo-only Jetson mock
(`server.mjs` + `fixtures.mjs` + `runtime-config.test.json`) implementing the
documented schema, used for manual/integration checks:

```bash
npm run mock-server &
cp tests/mockServer/runtime-config.test.json assets/runtime-config.json
npm run dev
```

The mock server refuses to start if `ALLOW_MOCK_SERVER_IN_PRODUCTION=true` is
set, and has no production entry point of its own.
`tests/mockServer/runtime-config.test.json` is for exactly this purpose —
manual/E2E testing — and must never be copied into a production `dist/`.

## 8. Privacy and transport

- No patient/session/calibration/clinical data is ever written to
  `localStorage`, `sessionStorage`, IndexedDB, or a service-worker cache —
  this bundle ships no such code paths at all.
- `runtime-config.json` carries no credentials, tokens, or PHI — see §2.
- Production requires `https://`/`wss://`; only `mode:"test"` on
  `localhost` may use plain `http`/`ws`, for local development against the
  mock server. No `runtime-config.json` ships in this bundle — see §2 — so a
  fresh checkout cannot accidentally build or run with test settings.
- No long-lived auth tokens are stored in the browser by this bundle; it
  has no authentication code path of its own — that belongs to whatever
  session/gateway layer the final deployment puts in front of the Jetson
  API.
- No PWA/offline caching is configured; none should be added without a
  dedicated PHI review.

## 9. Known limitations / non-goals

- Several **development-only** tooling dependencies (`vite`, `vitest`, and
  their transitive `esbuild`) carry known advisories in their current
  pinned versions (dev-server request handling, a Vitest UI RCE class of
  issue). None of this tooling ships inside `dist/` or `dist-demo/` — it
  only runs on a developer's machine via `npm run dev`/`npm test`. Bump
  these before use in any environment where an untrusted party can reach a
  running dev server or the Vitest UI.
- No authentication/authorization layer is implemented here; the Jetson-facing
  gateway is expected to provide TLS, auth and replay protection per the
  architecture boundary.
- Multi-session history is out of scope for this bundle. It renders a
  multi-session tile grid (latest reading per session) with partial-NEWS2
  alert tiers, and an adapter-first intake card (identity contract 1.1.0)
  as the only patient/adapter binding path.

## 10. Condensed project history

This bundle was extracted from the historical `dashboard-ui-monitor-veinnovate`
project (`VeinnoGate clinical-grade dashboard sync/`), which combined a
Claude-Design canvas UI with fully synthetic, in-browser vitals generation,
a superseded ABP-only `idle/computing/ready/failed` state machine, and an
(incorrect, since corrected here) claim that SpO₂ passes through unchanged
from the MAX30102. This bundle keeps the visual design language and
bilingual (EN/HE) approach, replaces the state machine with the
`VALID/ABSTAIN/RECALIBRATE/INFERENCE_ERROR/DEVICE_DISCONNECTED` contract,
removes all direct BLE/ONNX/model code (there was none to remove beyond
descriptive comments — the historical dashboard never touched them
directly), and isolates every synthetic-data code path behind an explicit,
separately-built demo entry point.

## Portability test

This bundle ships with no `node_modules/`, no `dist/`/`dist-demo/`, and no
`assets/runtime-config.json` — verify that stays true, and that a fresh copy
builds and runs entirely on its own, with a colon-free path (some shells
mis-split `PATH` around a literal `:` in a directory name, which is a shell
issue, not a bundle issue):

```bash
# 1-2. Copy only this directory outside the source repository, confirm it's clean
cp -R VeinoGate_Dashboard_integration_ready /tmp/veinogate-portability-check
cd /tmp/veinogate-portability-check
ls node_modules dist dist-demo assets/runtime-config.json 2>&1 | grep -q "No such file" && echo "clean: none present"

# 3-4. Install from the lockfile only, type-check, run all tests
npm ci
npm run typecheck
npm test

# 5. Optional standalone schema check (no Hardware_integration_ready sibling here -> SKIPPED, exit 0)
npm run check:schema-drift

# 6. Production and demo builds
npm run build
npm run build:demo

# 7. Verify production output
node scripts/check-no-random-in-prod.mjs
grep -rIl "demoDataSource\|main.demo\|DEMO — SYNTHETIC" dist/ && echo "FAIL: demo leaked into prod" || echo "clean: no demo code/banner in dist/"
grep -rIl "localhost:8787\|mode.:.test" dist/ && echo "FAIL: test config leaked into prod" || echo "clean: no test-mode config in dist/"

# 8. Mock-server E2E using the explicit test fixture
npm run mock-server &
cp tests/mockServer/runtime-config.test.json assets/runtime-config.json
npm run dev   # visit the dev URL and confirm live VALID/ABSTAIN/RECALIBRATE cycling, then stop the mock server

# 9. Remove the temporary copy
cd - && rm -rf /tmp/veinogate-portability-check

# 10. Confirm the original bundle still has no installed/generated directories
ls VeinoGate_Dashboard_integration_ready/node_modules 2>&1 | grep -q "No such file" && echo "clean"

# 11. Regenerate and spot-check the manifest (from inside the bundle, after npm ci there)
node scripts/generate-manifest.mjs
```
