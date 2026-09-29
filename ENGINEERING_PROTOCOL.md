# VeinnoGate Patient Monitor Dashboard — Engineering & Integration Protocol

**File this describes:** `Veinnovate Dashboard.dc.html`
**Status:** visual mockup. Every clinical number on screen is synthetic.
**Audience:** the engineer or AI agent merging this dashboard with the other project
components (adapter firmware, VeinnoGate/Jetson edge service, VeinNet inference,
hospital record system).

---

## 0. Read this first

This file is a **UI truth source, not a data truth source.**

- Every layout, state, label, colour, threshold, timing and interaction in the
  dashboard is deliberate and should survive integration.
- Every *value* — heart rate, SpO₂, predicted pressure, battery, RSSI, timestamps —
  is generated locally by a synthetic physiology engine so the interface can be
  judged without hardware. All of it must be replaced by real telemetry.
- The synthetic engine is **not** a placeholder that returns random numbers. It
  models the relationships the real system must also honour (§3). If real data ever
  looks less coherent than this mockup, the integration is wrong.
- Nothing here is cleared for clinical use. Thresholds are demo defaults (§5.1) and
  must be replaced with the unit's protocol before any patient sees this screen.

Everything lives in one file. The template (markup) is between `<x-dc>` and
`</x-dc>`; the logic class is the `<script data-dc-script>` block below it. There is
no build step, no framework install, no network call.

---

## 1. Domain model

The dashboard holds an array of **monitors**. One monitor = one adapter = one bed.

```js
{
  id: "m7x2k9a",                 // dashboard-local handle
  adapterId: "E4:5F:75:A0:DB:06", // BLE MAC — the real join key with VeinnoGate
  state: "monitoring",            // see §2
  patient: {
    name: "Miriam Cohen",
    nationalId: "311234577",      // 9 digits; the discharge confirmation key
    department: "Internal A",
    bed: "12",
    demographics: {               // mockup shape; real profile is {age_years, sex}
      age: 74, sex: "female",
      hypertension: true, chf: true, mi: null, stroke: false,
      arrhythmia: true, valveDisease: null, respiratoryFailure: false
    }
  },
  auditLog: [                     // newest first
    { field: "bed", from: "10", to: "12", changedAt: 1723..., changedBy: "Dana Levi" }
  ],
  vitals: {
    hr: 129,                      // measured, from PPG
    spo2: 97,                     // measured, from PPG
    packetReceivedAt: 1723...,    // last EVENT packet
    abp: {
      systolic: 156, diastolic: 101,
      predictedAt: 1723...,
      isPrediction: true,         // never a cuff measurement — always true
      status: "ready"             // idle | computing | ready | failed
    }
  },
  news:  { total: 2, tier: "urgent" },        // §5
  alert: { flags: [...], at: ..., tier: "urgent", total: 2 },  // absent when clear
  adapter: { battery: 90, bleRssi: -78, lastSeenAt: 1723... },
  createdAt: 1723...
}
```

**Field ownership after integration**

| Field | Real owner | Notes |
|---|---|---|
| `adapterId` | adapter firmware | The identity everything else joins on. |
| `state` | dashboard, derived | Never sent by the device; computed from traffic. |
| `patient.*` | hospital record / this form | The only data a human types here. |
| `auditLog` | dashboard → VeinnoGate | Must be persisted server-side, not in the browser. |
| `vitals.hr`, `vitals.spo2` | adapter (PPG) | Measured on-device. |
| `vitals.abp.*` | VeinNet on VeinnoGate | Predicted. Must stay flagged as prediction. |
| `news`, `alert` | dashboard, derived | Recompute server-side if alarms must survive a closed browser. |
| `adapter.battery/bleRssi/lastSeenAt` | keep-alive frame | Device telemetry only. |

---

## 2. Monitor state machine

| State | Label shown | Entered when | Tile shows |
|---|---|---|---|
| `awaiting_identification` | Awaiting details | An adapter powers on with no patient bound | Prompt + "Identify patient" button; no vitals |
| `monitoring` | Monitoring | Patient identified, link alive | Vitals, or "Waiting for data" until the first packet |
| `predicting` | Predicting | An event packet arrived, inference running | HR/SpO₂ live; ABP replaced by the computing animation |
| `disconnected` | Disconnected | Link lost | Last known values, frozen, dimmed, red banner, sorted to the end |
| `closing` | Closing | Discharge confirmed | 10 s countdown overlay with Undo |

Transitions in code: `deliverPacket` (monitoring→predicting), `finishPrediction`
(predicting→monitoring), `setDisconnected`, `scheduleReconnect`, `closeMonitor`,
`undoClose`, `saveForm` (awaiting→monitoring).

**Integration note.** In the real system `disconnected` must be derived from a
missed keep-alive deadline, not from a probability. See §4.

---

## 3. Synthetic physiology — what it models and why

Located in the logic class: `profile()`, `excursionHr()`, `makeAbp()`, `makeSpo2()`.

**The rule that matters: HR, SpO₂ and ABP all come from one PPG waveform, so they
may never contradict each other.** An earlier build drew each independently and
produced impossible tiles (bradycardia with a soaring systolic). That is the single
most important behaviour to preserve when real data arrives — if the integration
ever shows an ABP that does not track its own HR, the pairing of packet to
prediction has been lost.

**3.1 Resting profile** — one per patient, derived from the demographics form:

| Input | Effect on baseline |
|---|---|
| age | SBP +0.45/yr over 40; DBP +0.12/yr, then −0.38/yr past 60 (pulse pressure widens with arterial stiffness) |
| hypertension | SBP +17, DBP +8 |
| CHF | SBP −8, DBP −4, HR +8, SpO₂ −2 |
| MI | SBP −4, HR +2 |
| stroke | SBP +5 |
| arrhythmia | HR +7 |
| valve disease | SBP +7, DBP −6 (regurgitant wide pulse pressure) |
| respiratory failure | HR +10, SpO₂ −6 |
| sex = female | HR +3, SBP −3 |
| unknown (`null`) | contributes nothing — the training-group mean, exactly as the form promises |

Synthetic-only: the real VeinNet model uses no comorbidity inputs (age and sex only).

**3.2 Excursion** — a packet exists only because HR left the resting band:
tachycardic (+28…64 bpm, ~2/3 of events) or bradycardic (−18…34 bpm).

**3.3 Pressure from rate**

- Tachycardia: cardiac output rises, diastole shortens → `SBP += Δ×0.46`, `DBP += Δ×0.34`.
- Bradycardia: larger stroke volume with a long diastolic runoff → `SBP += |Δ|×0.18`,
  `DBP -= |Δ|×0.5` — systolic holds while diastolic falls, widening pulse pressure.
- Residual error ±5 mmHg stands in for VeinNet's own error band.
- Clamps: SBP 72–205, DBP 35–125, pulse pressure held to 25–95 mmHg.

**3.4 Saturation** — baseline ±, minus 1–3 points above 140 bpm and 1–2 below 45.

**Reference ranges used** (adult, at rest): HR 60–100 bpm · SpO₂ 95–100% ·
BP <120/80 normal, ≥140/90 hypertensive · pulse pressure 30–50 mmHg ·
MAP = DBP + PP/3, normal 70–100 mmHg.

**Replace with:** the real HR/SpO₂ from the adapter and the real VeinNet output.
Delete `profile`/`excursionHr`/`makeAbp`/`makeSpo2` at that point — but keep §3's
coherence rule as an integration test.

---

## 4. Timing — demo values vs. ward values

Two independent uplinks, matching the firmware specification.

| Channel | Carries | Demo | Expected in the ward | Code |
|---|---|---|---|---|
| **Event packet** | PPG features → triggers inference | every 20–65 s | only on a heart-rate excursion, typically minutes apart | `schedulePacket` |
| **Keep-alive** | battery, link quality, liveness only — no waveform, no inference | every 60–95 s | fixed cadence, order of minutes | `scheduleKeepAlive` |
| VeinNet inference | — | 1.5–3.0 s | measure it; the UI tolerates any value, the animation just runs longer | `finishPrediction` |
| Inference failure | — | 8% of packets | real model/link failure rate | `deliverPacket` |
| Dropout check | — | on each keep-alive: 3%, or 14% when RSSI < −78 dBm | **replace with a missed-keep-alive deadline** | `scheduleKeepAlive` |
| Auto-reconnect | — | 18–45 s after dropout | BLE re-advertise + rejoin | `scheduleReconnect` |
| Undo window on discharge | — | 10 s | keep; it is a safety property, not a demo convenience | `closeMonitor` |
| Toast dismissal | — | 6 s | keep | `showToast` |
| Relative-time refresh | — | 500 ms tick | keep | `componentDidMount` |

**Why two channels.** The keep-alive is what separates *"quiet patient, nothing to
report"* from *"dead link"*. Without it a silent adapter and a healthy adapter look
identical. The dashboard therefore shows the last keep-alive time in the signal
tooltip, and the footer timestamp separately shows the last **event packet**. Both
must be wired; do not collapse them into one.

---

## 5. Alerting

### 5.1 Absolute limits — `LIMITS` in the logic class

| Key | Value | Meaning |
|---|---|---|
| `sysHigh` | > 160 | severe hypertension |
| `sysLow` | < 90 | hypotension → **critical** |
| `diaHigh` | > 100 | severe diastolic elevation |
| `diaLow` | < 50 | low diastolic pressure |
| `mapLow` | < 65 | perfusion floor |
| `mapCrit` | < 55 | critical hypoperfusion → **critical** |
| `crisisSys` / `crisisDia` | ≥ 180 / ≥ 120 | hypertensive crisis → **critical** |
| `spo2Low` | < 92 % | hypoxaemia |
| `spo2Crit` | ≤ 88 % | critical hypoxaemia → **critical** |

⚠️ Demo defaults. Replace with the unit's own protocol **and mirror the same numbers
into the VeinnoGate configuration** — a threshold that exists in only one of the two
places is a silent failure mode.

### 5.2 Graded score — partial NEWS2

Scoring follows NEWS2 (Royal College of Physicians, 2017) for the three parameters
this device provides:

| Parameter | 3 | 2 | 1 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|---|---|---|
| SpO₂ (Scale 1) | ≤91 | 92–93 | 94–95 | ≥96 | | | |
| Pulse | ≤40 | | 41–50 | 51–90 | 91–110 | 111–130 | ≥131 |
| Systolic BP | ≤90 | 91–100 | 101–110 | 111–219 | | | ≥220 |

> **The aggregate is a floor, never a complete NEWS2.** Respiratory rate,
> temperature and level of consciousness are not measured by this adapter. The
> dashboard says so in the chip tooltip. **The integration must feed those three in
> from the ward's own observations before this number is presented to a clinician as
> NEWS2.** Until then it is a partial score and must be labelled as one.

### 5.3 Tiers

| Tier | Raised when | Presentation |
|---|---|---|
| `routine` | aggregate 0, no limit breach | chip only, muted |
| `watch` | aggregate ≥ 1, no limit breach | cyan chip, **no banner, no sound** |
| `urgent` | any absolute limit breached, or aggregate ≥ 5, or SpO₂/SBP alone scoring 3 | amber banner, 1.8 s pulse, 3-pulse tone |
| `critical` | aggregate ≥ 7, hypertensive crisis, MAP < 55, SpO₂ ≤ 88, or SBP < 90 | red banner, 0.9 s pulse, 5-pulse tone repeated |

Tone design follows IEC 60601-1-8 alarm signals: medium priority = burst of three,
high priority = burst of five at a higher pitch, repeated. Muting is global
(speaker button in the header) and does not suppress the visual alarm.

**A burst is not enough on its own.** An unattended alarm has to keep asking, and ask
more often the longer it goes unattended, so it cannot be waited out. IEC 60601-1-8
allows a high-priority burst to repeat every 2.5–15 s and a medium-priority burst
every 15–30 s; the schedule below stays inside those bands and tightens with time.

| Tier | Repeat interval | After 30 s | After 75 s | After 90 s |
|---|---|---|---|---|
| watch | silent | — | — | — |
| urgent | 25 s | 25 s | 25 s | **16 s** |
| critical | 10 s | **6 s** | **3 s** | 3 s |

A critical alarm therefore ends up roughly eight times more insistent than an urgent
one. The clock (`alert.at`) is the moment the condition was first raised, and it
**survives subsequent packets that report the same condition** — a persistent alarm
keeps counting instead of resetting its escalation every reading. It resets only when
the reason set or the tier changes, or when the condition clears. The banner shows
the elapsed time once it passes 10 s, so a nurse can see at a glance how long a bed
has been calling.

Driven by `alarmLoop` / `alarmTick` (1 s cadence) against `ALARM_REPEAT`.

> **Integration:** these intervals are the mockup's presentation timings. Keep the
> escalation *shape* but re-derive the numbers with the unit — repetition rate is an
> alarm-fatigue lever, and the right value depends on staffing ratio and bed count.
> The escalation clock must also be evaluated server-side (§7); an alarm that only
> escalates while a browser tab happens to be open is not an alarm.

**A lone heart-rate excursion never raises a banner.** Pulse feeds the aggregate but
does not escalate on its own — that was a deliberate choice, since this adapter
transmits *because* of an HR excursion and every packet would otherwise alarm.

### 5.4 Lifecycle

- **Non-latching.** An alert clears itself when the next prediction is back in range.
- The tone fires only when the *reason set or tier changes*, so a persistent
  condition does not re-alarm on every packet.
- **Acknowledge** dismisses the banner and stops the repetition until the next
  reading. It does not silence a re-raise, and
  it is not currently written to the audit log — **add that in integration**; an
  acknowledgement is a clinical action and needs a name and a timestamp.
- SpO₂ and pulse are measured, so they still score and still alarm when the pressure
  inference fails; only the pressure reasons drop out of the list.
- Alerts survive `disconnected` (last known state stays on screen) and are cleared by
  discharge.

---

## 6. Screen-by-screen inventory

### 6.1 Sign-in
Email + password (any email, ≥4-char password), Remember me, hospital SSO.
The signed-in name is written into `auditLog.changedBy` for every subsequent edit.
"Remember me" controls whether the session is persisted.
**Replace with:** real hospital SSO/IdP. `changedBy` must become a verified identity,
not a string parsed from an email local-part.

### 6.1b Shift & attribution

The **shift** is ward context, not an account. It is held separately from the signed-in
session: `shift = { charge, key, startedAt }` where `key` is `morning` | `evening` |
`night` (defaulted from the clock: 07–15 / 15–23 / else).

**Handover.** The shift chip in the header opens the handover dialog: current charge
nurse with the time she took over, the incoming name, and the shift being started.
Completing it swaps the charge nurse and restarts the shift clock — and **touches
nothing else**. No monitor is closed, no timer reset, no prediction cancelled, no
alarm cleared or re-raised, no adapter re-paired. That isolation is the requirement;
a handover during a critical alarm must not interrupt the alarm.

**Attribution.** The charge nurse is rarely the only person entering data. Every edit
form therefore carries a **Recorded by** field, prefilled with the signed-in user and
freely editable, and each audit entry stores both:

```js
{ field, from, to, changedAt, changedBy: "Noa Barak", shiftCharge: "Dana Levi" }
```

The change log shows the person who made the change as the attribution, and appends
the charge nurse in small muted text **only when the two differ** — so a normal entry
stays a single clean line and the extra context appears exactly when it carries
information. The same rule drives the note beside the Recorded-by field
("· on Dana Levi's shift"), shown only on a mismatch.

> **Integration.** `changedBy` must become a verified identity, not free text — a
> badge tap, a second credential, or a roster pick. `shiftCharge` should be resolved
> server-side from the roster at `changedAt`, never trusted from the client. Handover
> itself is a clinical event and needs its own server-side record (who, to whom,
> when, which beds were open, which alarms were live) — the mockup only toasts it.

### 6.2 Header
| Control | Does | Integration |
|---|---|---|
| Active count | monitors that are neither disconnected nor closing | — |
| Manual sync | re-poll VeinnoGate's adapter list; toast reports the count | wire to the real list endpoint |
| Open monitor | manual pairing dialog (§6.5) | mockup only — removed in the implementation (§6.5) |
| Speaker | global alarm mute; visual alarms unaffected | keep — muting is often policy-restricted |
| EN / עב | language + full RTL flip | — |
| Shift chip | current shift + charge nurse; opens handover (§6.1b) | wire to the roster |
| User chip / sign out | identity and session | — |
| VeinnoGate banner | appears when the edge link is down; blocks packets and fails any inference in flight | wire to real connection state |

### 6.3 Monitor tile
Reading top to bottom: patient name · national-ID chip · department · bed ·
adapter MAC · state pill · NEWS chip (score + tier) · HR · SpO₂ · ABP with the
**PREDICTED** badge · alert banner · waiting/disconnected banner · last-packet time ·
"Partial demographics" chip · BLE signal (tooltip carries the last keep-alive) ·
battery · Edit / Change log / Discharge.

- The **PREDICTED** badge is not decoration. ABP is a VeinNet inference from the PPG
  waveform, never a cuff measurement. It must never be presented as measured.
- The ABP block has four visual states: `idle` (—), `computing` (amber dots + scan
  bar, distinct from the instantly-updating HR/SpO₂), `ready`, `failed`.
- "Partial demographics" appears when any model input is `null` and warns that the
  prediction used training-group means for those features (mockup only; the
  implementation requires age and sex, so this state does not occur).
- Tiles sort: alerting → normal → disconnected → closing.

### 6.4 Identification form (two phases)
**Phase 1 — identification.** Name, national ID (9 digits), department, bed. All four
are required; Next stays disabled until they are filled. The national ID is the key
the discharge confirmation matches against.
**Phase 2 — demographics.** Age (18–120, blocks Save when out of range) plus the
eight model inputs in **fixed order**: sex, hypertension, CHF, MI, stroke,
arrhythmia, valve disease, respiratory failure. Every one may be left *Unknown*.
Saving writes a per-field audit entry with the signed-in name and, for a new adapter,
moves the monitor out of `awaiting_identification`.
> Field order matches the VeinNet input vector. **Do not reorder it** without
> changing the model contract.
Editing demographics mid-stay affects the **next** prediction only; predictions
already displayed are not retroactively recomputed. This is stated in the form.
> **Implementation note.** The frozen VeinNet model uses **age and sex only**
> (demographics contract 1.0.0); the seven comorbidity fields are not model inputs
> and are not collected by the implemented dashboard
> (`VeinoGate_Dashboard_integration_ready/`). Its intake is a single card:
> adapter-code confirmation, then patient ID, first and last name, national ID,
> age and sex (all required), plus optional department and bed. The "fixed order"
> warning above applies to the mockup only.

### 6.5 Manual open
Backup route when automatic detection fails: lists unpaired adapters reported by
VeinnoGate, or powers on a new one. **Replace the generated MAC list** with the real
unpaired-adapter endpoint.
> **Implementation note.** The manual-pairing side panel (AdapterPairingView) was
> removed. Intake happens only through the intake card, which opens automatically
> when an adapter is detected.

### 6.6 Change log
Per-monitor, newest first: field, from → to, timestamp, who. Currently browser-local.
**Must move server-side** — it is the record that travels with the patient.

### 6.7 Discharge
Deletes the patient record from the VeinnoGate database and the local backup once the
undo window ends. Confirmation requires typing the national ID **exactly** as
entered when the monitor was opened. A monitor with no patient identified has no
record to delete and closes on confirmation alone.
Then a 10-second countdown **on the tile itself** with Undo. Deletion is only issued
when that window expires.
> **Integration: do not send the delete on confirm.** Send it when the undo window
> closes, or send it immediately with a compensating restore — but the 10 s window
> must be honoured somewhere.

### 6.8 Demo controls panel
**Remove this panel entirely before any clinical build.** It exists to drive the
mockup: power on a new adapter, toggle the VeinnoGate link, reset all, and per
monitor — send a packet, force an inference failure, force a hypertensive crisis,
connect/disconnect.

---

## 7. Persistence

`localStorage`, two keys, debounced 300 ms:

- `veinnovate.monitors` — `{ v, monitors, adapterSeq }`
- `veinnovate.session` — `{ user, lang, shift }`, user omitted unless "Remember me"

`SCHEMA` is bumped whenever the monitor shape or the physiology model changes; a
stale payload is discarded rather than restored half-valid. On restore, an inference
that was interrupted by the reload is **re-run**, never left dangling — that bug
produced tiles showing an alert, a `—` and "waiting for data" at the same time.

**Replace with:** server state. Patient data in browser storage is not acceptable in
production. Alarms must also be evaluated server-side so they survive a closed tab.

---

## 8. Language & layout

English and Hebrew, complete parity, in the `T` object. Hebrew flips the document to
RTL. Numeric runs — IDs, MAC, dBm, battery, vitals — are forced `dir="ltr"` with
`unicode-bidi: isolate` so they never reorder inside Hebrew text. Any new string must
be added to **both** language blocks; a missing key renders empty.

Palette: background `#06162C`, surface `#0F2745`, raised `#16345C`, border `#1E4372`,
text `#FEFDF8`, muted `#A9BDD6`/`#6B84A3`, cyan `#7FD8E0`, green `#6FE3C4`,
amber `#F5C56B`, red `#E8735A`. Type: Poppins for headings, Inter/Heebo for body.
Tier colours are fixed to this palette (`TIER_COLOR`); alarm colour is meaning, not
decoration — do not restyle amber/red for aesthetics.

---

## 9. Integration checklist

1. Replace the synthetic engine (§3) with real adapter telemetry and VeinNet output.
   Keep the coherence invariant: **the ABP shown must be the inference from the
   packet whose HR is shown.**
2. Wire both uplinks separately (§4). Derive `disconnected` from a missed keep-alive
   deadline, not a probability.
3. Load thresholds from configuration and mirror them into VeinnoGate (§5.1).
4. Feed respiratory rate, temperature and consciousness before calling the score
   NEWS2 (§5.2).
5. Move `auditLog` server-side and add an acknowledgement record (§5.4, §6.6).
   Resolve `shiftCharge` from the roster server-side and record handovers (§6.1b).
6. Evaluate alarms server-side so they survive a closed browser (§7).
7. Replace sign-in with the hospital IdP; make `changedBy` a verified identity (§6.1).
8. Honour the 10 s undo window before issuing the delete (§6.7).
9. ~~Point manual pairing at the real unpaired-adapter list (§6.5).~~ Obsolete:
   manual pairing was removed; intake is card-only (§6.5).
10. Delete the demo controls panel (§6.8).
11. Keep the PREDICTED badge and its tooltip on every ABP display, always.

---

## 10. Known simplifications

- ABP is the only predicted value; HR and SpO₂ are treated as measured.
- No trends, history or waveform view — a tile shows the latest reading only.
- No roles or permissions; any signed-in user can edit and discharge.
- National ID is validated for length only, not by check digit (mockup; the
  implementation's backend validates the Israeli ID check digit).
- The audit log records field changes, not views, acknowledgements or exports.
- Alarm escalation has no timeout — an unacknowledged critical alert does not
  auto-escalate to a second recipient.
