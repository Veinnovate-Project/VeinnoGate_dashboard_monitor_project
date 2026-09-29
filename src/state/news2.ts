import type { JetsonResult } from "./resultTypes";

/**
 * Partial NEWS2 (Royal College of Physicians, 2017) computed from the three
 * parameters this adapter actually measures: SpO2 (Scale 1), pulse, and
 * systolic BP. Respiratory rate, temperature, and level of consciousness are
 * not measured here -- ported from the historical mockup's own explicit
 * caveat (dashboard-ui-monitor-veinnovate ENGINEERING_PROTOCOL.md §5.2):
 * "The aggregate is a floor, never a complete NEWS2" -- and must stay
 * labelled as partial in the UI, never presented as a full clinical score.
 *
 * Fail-closed: only ever scores a VALID result whose hr/spo2/bp are all
 * non-null. Any other state -- ABSTAIN, RECALIBRATE, missing HR, or
 * spo2.status !== "VALID" (production status today) -- returns
 * `available: false` rather than a fabricated or partially-computed number.
 */
export interface News2Result {
  available: boolean;
  score: number | null;
  spo2Points: number | null;
  pulsePoints: number | null;
  sbpPoints: number | null;
}

function spo2Points(pct: number): number {
  if (pct <= 91) return 3;
  if (pct <= 93) return 2;
  if (pct <= 95) return 1;
  return 0;
}

function pulsePoints(bpm: number): number {
  if (bpm <= 40) return 3;
  if (bpm <= 50) return 1;
  if (bpm <= 90) return 0;
  if (bpm <= 110) return 1;
  if (bpm <= 130) return 2;
  return 3;
}

function sbpPoints(mmhg: number): number {
  if (mmhg <= 90) return 3;
  if (mmhg <= 100) return 2;
  if (mmhg <= 110) return 1;
  if (mmhg <= 219) return 0;
  return 3;
}

export function computeNews2(result: JetsonResult): News2Result {
  const unavailable: News2Result = { available: false, score: null, spo2Points: null, pulsePoints: null, sbpPoints: null };

  if (result.result_state !== "VALID") return unavailable;
  if (!result.hr.valid || result.hr.bpm === null) return unavailable;
  if (result.spo2.status !== "VALID" || result.spo2.pct === null) return unavailable;
  if (result.bp.sbp_mmhg === null) return unavailable;

  const sp = spo2Points(result.spo2.pct);
  const pp = pulsePoints(result.hr.bpm);
  const bp = sbpPoints(result.bp.sbp_mmhg);
  return { available: true, score: sp + pp + bp, spo2Points: sp, pulsePoints: pp, sbpPoints: bp };
}
