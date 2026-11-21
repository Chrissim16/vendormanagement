import type { Request } from "express";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../../../db/schema";
import type { CheckResult } from "../../../shared/types";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything a query can run on: the database itself or an open transaction. */
export type Queryable = Db | Tx;

export type PortKind = "stand-in" | "real";

export interface Identity {
  email: string;
  name: string | null;
}

/** Who is making this request. The only source of user identity in the app. */
export interface IdentityPort {
  kind: PortKind;
  resolve(req: Request): Identity | null;
  check(req: Request): Promise<CheckResult>;
}

export interface DatabasePort {
  kind: PortKind;
  db: Db;
  migrate(): Promise<void>;
  check(): Promise<CheckResult>;
  close(): Promise<void>;
}

/** Stores uploaded documents. Keys are relative paths such as `agreements/<id>/<file>`. */
export interface StoragePort {
  kind: PortKind;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  check(): Promise<CheckResult>;
}

export interface JiraProject {
  key: string;
  name: string;
}

/** Jira Service Management. Grows in milestone M3 with ticket search. */
export interface JiraPort {
  kind: PortKind;
  listProjects(): Promise<JiraProject[]>;
  check(): Promise<CheckResult>;
}

export interface AiRequest {
  /** Which model to use: careful writing and judgement, or quick high-volume work. */
  tier: "strong" | "fast";
  system: string;
  user: string;
  /** Ask for a JSON object back. */
  json?: boolean;
  maxTokens?: number;
}

export interface AiResponse {
  text: string;
  model: string;
}

/** The language model. Only `server/ai` may call this. */
export interface AiPort {
  kind: PortKind;
  complete(req: AiRequest): Promise<AiResponse>;
  check(): Promise<CheckResult>;
}

export interface Ports {
  identity: IdentityPort;
  database: DatabasePort;
  storage: StoragePort;
  jira: JiraPort;
  ai: AiPort;
}
