import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Compares this bundle's consumer schemas against the producer schemas shipped
// by the sibling Hardware_integration_ready bundle, once it exists alongside
// this one (see Veinnovate_Prototype/ layout in README.md). Uses a relative
// sibling path only -- never an absolute path to another repo.
//
// Two modes:
//   default (no flag): SKIPS (exit 0) when the sibling isn't present yet --
//     used for standalone portability where this bundle is copied alone.
//   --strict: the sibling and every producer schema MUST exist and match
//     byte-for-byte -- used for the final three-component acceptance test.

const strict = process.argv.includes("--strict");

const here = dirname(fileURLToPath(import.meta.url));
const bundleRoot = join(here, "..");
const siblingSchemaDir = join(bundleRoot, "..", "Hardware_integration_ready", "schemas");

const schemaFiles = ["jetson-result.schema.json", "jetson-ws-envelope.schema.json"];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (!existsSync(siblingSchemaDir)) {
  if (strict) {
    console.error(`[schema-drift:strict] FAILED: sibling producer schemas not found at ${siblingSchemaDir}`);
    process.exit(1);
  }
  console.log(`[schema-drift] SKIPPED: sibling producer schemas not found at ${siblingSchemaDir}`);
  process.exit(0);
}

let drifted = false;
for (const file of schemaFiles) {
  const consumerPath = join(bundleRoot, "schemas", file);
  const producerPath = join(siblingSchemaDir, file);
  if (!existsSync(producerPath)) {
    console.error(`[schema-drift${strict ? ":strict" : ""}] MISSING producer schema: ${producerPath}`);
    drifted = true;
    continue;
  }
  const consumerHash = sha256(consumerPath);
  const producerHash = sha256(producerPath);
  if (consumerHash !== producerHash) {
    console.error(`[schema-drift${strict ? ":strict" : ""}] MISMATCH in ${file}: consumer=${consumerHash} producer=${producerHash}`);
    drifted = true;
  }
}

if (drifted) {
  console.error(`[schema-drift${strict ? ":strict" : ""}] FAILED: consumer and producer schemas are not byte-identical.`);
  process.exit(1);
}

console.log(`[schema-drift${strict ? ":strict" : ""}] OK: consumer and producer schemas match.`);
