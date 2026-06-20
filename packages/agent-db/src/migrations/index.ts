import { migration0001 } from "./0001_init.js";

export interface Migration {
  id: string;
  sql: string;
}

/** Migrations in apply order. Append new ones; never edit an applied migration. */
export const migrations: Migration[] = [migration0001];
