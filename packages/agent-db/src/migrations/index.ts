import { migration0001 } from "./0001_init.js";
import { migration0002 } from "./0002_review_resolution.js";

export interface Migration {
  id: string;
  sql: string;
}

/** Migrations in apply order. Append new ones; never edit an applied migration. */
export const migrations: Migration[] = [migration0001, migration0002];
