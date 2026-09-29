import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import runtimeConfigSchema from "../../schemas/runtime-config.schema.json";

export interface RuntimeConfig {
  config_schema_version: "1.0.0";
  mode: "production" | "test";
  jetson_rest_base_url: string;
  jetson_websocket_url: string;
  expected_result_schema_version: string;
  connection_timeout_ms: number;
  stale_after_seconds: number;
}

export class RuntimeConfigError extends Error {}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(runtimeConfigSchema);

function assertSecureUrl(url: string, mode: RuntimeConfig["mode"], field: string): void {
  const parsed = new URL(url);
  const isHttpsOrWss = parsed.protocol === "https:" || parsed.protocol === "wss:";
  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isHttpsOrWss) return;
  if (mode === "test" && isLocalhost) return;
  throw new RuntimeConfigError(
    `${field} uses an insecure scheme (${parsed.protocol}). Only https/wss are permitted outside mode:"test" on localhost.`
  );
}

/**
 * Fetches and validates runtime-config.json. Fails visibly (throws) rather than
 * ever falling back to demo data or a hardcoded backend address -- per spec,
 * production must never silently degrade.
 */
export async function loadRuntimeConfig(configUrl = "/runtime-config.json"): Promise<RuntimeConfig> {
  let raw: unknown;
  try {
    const response = await fetch(configUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new RuntimeConfigError(`Failed to fetch ${configUrl}: HTTP ${response.status}`);
    }
    raw = await response.json();
  } catch (err) {
    if (err instanceof RuntimeConfigError) throw err;
    throw new RuntimeConfigError(`Could not load or parse ${configUrl}: ${(err as Error).message}`);
  }

  if (!validate(raw)) {
    const details = ajv.errorsText(validate.errors, { separator: "; " });
    throw new RuntimeConfigError(`runtime-config.json failed schema validation: ${details}`);
  }

  const config = raw as unknown as RuntimeConfig;
  assertSecureUrl(config.jetson_rest_base_url, config.mode, "jetson_rest_base_url");
  assertSecureUrl(config.jetson_websocket_url, config.mode, "jetson_websocket_url");
  return config;
}
