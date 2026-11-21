import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors";
import type { StoragePort } from "./types";
import type { CheckResult } from "../../../shared/types";

/** Keys are relative, forward-slashed, and may not climb out of the store. */
export function safeKey(key: string): string {
  const parts = key.split("/");
  if (!key || key.startsWith("/") || key.includes("\\") || parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new AppError(400, "bad_file_key", "That file location is not allowed.");
  }
  return key;
}

async function probe(store: Pick<StoragePort, "put" | "get" | "remove">, where: string, fix: string): Promise<CheckResult> {
  const key = `_system-check/probe-${Date.now()}.txt`;
  try {
    await store.put(key, Buffer.from("ok"), "text/plain");
    const back = await store.get(key);
    await store.remove(key);
    if (back.toString() !== "ok") return { ok: false, detail: `A test file came back changed from ${where}.`, fix };
    return { ok: true, detail: `Wrote, read and removed a test file in ${where}.` };
  } catch (e) {
    return { ok: false, detail: `Could not store a test file in ${where}: ${(e as Error).message}`, fix };
  }
}

export function diskStorage(root: string): StoragePort {
  const file = (key: string) => path.join(root, safeKey(key));
  const store: StoragePort = {
    kind: "stand-in",
    async put(key, data) {
      await mkdir(path.dirname(file(key)), { recursive: true });
      await writeFile(file(key), data);
    },
    async get(key) {
      try {
        return await readFile(file(key));
      } catch {
        throw new AppError(404, "file_missing", "That file no longer exists.");
      }
    },
    async remove(key) {
      await rm(file(key), { force: true });
    },
    check: () => probe(store, `the folder ${root}`, "Check that the app may write to that folder."),
  };
  return store;
}

/**
 * Deployed: a Unity Catalog volume through the Files API. UNPROVEN until first deployment.
 * `getToken` returns a workspace access token for the app's service principal.
 */
export function volumeStorage(host: string, volumePath: string, getToken: () => Promise<string>): StoragePort {
  const url = (key: string) => `${host.replace(/\/$/, "")}/api/2.0/fs/files${volumePath.replace(/\/$/, "")}/${safeKey(key).split("/").map(encodeURIComponent).join("/")}`;
  const call = async (method: string, key: string, body?: Buffer) => {
    const res = await fetch(url(key) + (method === "PUT" ? "?overwrite=true" : ""), {
      method,
      headers: { Authorization: `Bearer ${await getToken()}`, ...(body ? { "Content-Type": "application/octet-stream" } : {}) },
      body: body ? new Uint8Array(body) : undefined,
    });
    if (res.status === 404 && method === "GET") throw new AppError(404, "file_missing", "That file no longer exists.");
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      throw new Error(`Databricks answered ${res.status} ${res.statusText}`);
    }
    return res;
  };
  const store: StoragePort = {
    kind: "real",
    async put(key, data) {
      await call("PUT", key, data);
    },
    async get(key) {
      return Buffer.from(await (await call("GET", key)).arrayBuffer());
    },
    async remove(key) {
      await call("DELETE", key);
    },
    check: () =>
      probe(store, `the volume ${volumePath}`, "Check that VOLUME_PATH points to an existing volume and that the app's service principal has READ VOLUME and WRITE VOLUME on it."),
  };
  return store;
}
