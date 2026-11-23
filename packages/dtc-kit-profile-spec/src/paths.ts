// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

export const SCHEMA_PATH = join(PACKAGE_ROOT, "schema", "requirements-profile.schema.json");
export const PROFILES_DIR = join(PACKAGE_ROOT, "profiles");
