import type { JetsonResult } from "./resultTypes";
import { computeNews2 } from "./news2";

/**
 * Alert tier, ported from the mockup's tier table
 * (ENGINEERING_PROTOCOL.md §5.3): routine/watch/urgent/critical, driven by
 * the partial-NEWS2 aggregate plus absolute limit breaches on the same three
 * measured parameters (SpO2, pulse feeds the aggregate only -- a lone HR
 * excursion never escalates on its own, mirroring the mockup's deliberate
 * choice since this adapter transmits *because of* an HR excursion) and SBP.
 *
 * Fail-closed: unavailable NEWS2 (see news2.ts) means `tier: null` -- never
 * "routine" by default, since "no alert" and "no data" must stay visibly
 * different states.
 *
 * ponytail: the mockup's own protocol flags its repeat-interval escalation
 * clock and audit-logged acknowledgement as needing to move server-side
 * before clinical use ("an alarm that only escalates while a browser tab
 * happens to be open is not an alarm"). No such backend exists yet in this
 * bundle. This module only computes the *tier* from real vitals; the
 * escalation timer and acknowledgement audit trail are wired client-side
 * only for this shell (see AlertBannerView) -- upgrade path: move both to
 * the Jetson once an authenticated audit endpoint exists.
 */
export type AlertTier = "routine" | "watch" | "urgent" | "critical";

export interface AlertResult {
  tier: AlertTier | null;
  reasons: string[];
}

export function computeAlertTier(result: JetsonResult): AlertResult {
  const news2 = computeNews2(result);
  if (!news2.available || news2.score === null) return { tier: null, reasons: [] };

  const spo2 = result.spo2.pct as number;
  const sbp = result.bp.sbp_mmhg as number;
  const reasons: string[] = [];

  const critical = news2.score >= 7 || spo2 <= 88 || sbp < 90;
  if (critical) {
    if (news2.score >= 7) reasons.push("NEWS2_AGGREGATE_CRITICAL");
    if (spo2 <= 88) reasons.push("SPO2_CRITICAL");
    if (sbp < 90) reasons.push("SBP_CRITICAL");
    return { tier: "critical", reasons };
  }

  const urgent =
    news2.score >= 5 ||
    (news2.spo2Points !== null && news2.spo2Points >= 3) ||
    (news2.sbpPoints !== null && news2.sbpPoints >= 3);
  if (urgent) {
    if (news2.score >= 5) reasons.push("NEWS2_AGGREGATE_URGENT");
    if (news2.spo2Points !== null && news2.spo2Points >= 3) reasons.push("SPO2_LIMIT");
    if (news2.sbpPoints !== null && news2.sbpPoints >= 3) reasons.push("SBP_LIMIT");
    return { tier: "urgent", reasons };
  }

  if (news2.score >= 1) return { tier: "watch", reasons: ["NEWS2_AGGREGATE_WATCH"] };

  return { tier: "routine", reasons: [] };
}
