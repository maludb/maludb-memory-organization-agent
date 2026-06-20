import { readFileSync } from "node:fs";

import { parse as parseYaml } from "yaml";

import { policySchema, type Policy } from "./schema.js";

/** Parse a YAML policy document (string) and validate it. Throws on invalid input. */
export function parsePolicyYaml(text: string): Policy {
  return policySchema.parse(parseYaml(text));
}

/**
 * Parse a YAML override document without filling defaults — returned as a raw object for
 * deep-merging onto a default (see merge.ts). Validation of the merged result happens in
 * resolveEffectivePolicy.
 */
export function parseOverrideYaml(text: string): unknown {
  return parseYaml(text);
}

/** Read + parse a complete policy file from disk. */
export function loadPolicyFile(path: string): Policy {
  return parsePolicyYaml(readFileSync(path, "utf8"));
}

/** Read an override file from disk as a raw object (not validated/defaulted on its own). */
export function loadOverrideFile(path: string): unknown {
  return parseOverrideYaml(readFileSync(path, "utf8"));
}
