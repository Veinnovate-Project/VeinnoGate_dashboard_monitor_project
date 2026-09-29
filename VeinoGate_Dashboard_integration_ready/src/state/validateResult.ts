import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import resultSchema from "../../schemas/jetson-result.schema.json";
import type { JetsonResult } from "./resultTypes";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateAgainstSchema = ajv.compile(resultSchema);

export type ValidationOutcome =
  | { ok: true; result: JetsonResult }
  | { ok: false; reason: "UNSUPPORTED_SCHEMA_VERSION"; receivedVersion: unknown }
  | { ok: false; reason: "MALFORMED"; details: string };

const SUPPORTED_SCHEMA_VERSIONS = new Set(["1.0.0"]);

/**
 * Validates a raw incoming payload against the canonical schema. A message that
 * fails validation for any reason (unknown fields, wrong types, an unsupported
 * schema_version, a future/unknown result_state) is rejected outright -- it is
 * never partially trusted or patched into a "best effort" reading.
 */
export function validateResult(raw: unknown): ValidationOutcome {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "MALFORMED", details: "payload is not an object" };
  }

  const schemaVersion = (raw as Record<string, unknown>).schema_version;
  if (typeof schemaVersion !== "string" || !SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    return { ok: false, reason: "UNSUPPORTED_SCHEMA_VERSION", receivedVersion: schemaVersion };
  }

  if (!validateAgainstSchema(raw)) {
    const details = ajv.errorsText(validateAgainstSchema.errors, { separator: "; " });
    return { ok: false, reason: "MALFORMED", details };
  }

  return { ok: true, result: raw as unknown as JetsonResult };
}
