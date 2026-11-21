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

/** What "Test link" needs to know about a board. */
export interface JiraBoard {
  key: string;
  name: string;
  /** Whether it is a Jira Service Management project; only those have SLAs and satisfaction ratings. */
  serviceDesk: boolean;
  /** Every status tickets on this board can have. */
  statuses: string[];
  /** Labels found on the board's most recently changed tickets. */
  labels: string[];
  /** Whether this Jira has each of the measurements the metrics are built on. */
  measures: { firstResponse: boolean; resolution: boolean; satisfaction: boolean };
}

/** One ticket as the app needs it, whatever shape Jira sent it in. */
export interface JiraTicket {
  key: string;
  summary: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  firstResponseAt: Date | null;
  /** Null while Jira has no outcome: not answered yet and still in time, or no SLA on the ticket. */
  firstResponseBreached: boolean | null;
  resolutionBreached: boolean | null;
  /** 1 to 5, when the person who asked gave a rating. */
  csat: number | null;
  csatAt: Date | null;
  /** Every status and every label the ticket has carried, now or earlier. */
  statusesSeen: string[];
  labelsSeen: string[];
}

/** Jira Service Management: the boards, and the tickets on them. */
export interface JiraPort {
  kind: PortKind;
  listProjects(): Promise<JiraProject[]>;
  /** Fails with `status: 404` when the board does not exist or the account cannot see it. */
  describeBoard(projectKey: string): Promise<JiraBoard>;
  /**
   * The board's tickets as they stand at `now`: those changed since `since`, and always every
   * unresolved ticket. With `since` null: every unresolved ticket and those resolved in the
   * last two years. An unresolved ticket that is not in the answer no longer exists on the
   * board. Asking twice gives the same tickets.
   */
  fetchTickets(projectKey: string, since: Date | null, now: Date): Promise<JiraTicket[]>;
  /** Where a person can open the ticket, or null when there is nowhere. */
  ticketUrl(ticketKey: string): string | null;
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
  /** Stand-in only: make the AI unreachable or make it answer nonsense, to try what the app does then (AI-2). */
  simulate?(mode: AiMode): void;
}
export const aiModes = ["working", "unavailable", "nonsense"] as const;
export type AiMode = (typeof aiModes)[number];

export interface Ports {
  identity: IdentityPort;
  database: DatabasePort;
  storage: StoragePort;
  jira: JiraPort;
  ai: AiPort;
}
