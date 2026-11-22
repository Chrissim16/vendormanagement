import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { wordTemplates } from "../../../db/schema";
import type { User } from "../../../shared/types";
import { audit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import type { Db, Queryable, StoragePort } from "../../platform/ports/types";
import { plainTemplate } from "./word/plain";
import type { TemplateFound, WordTemplateInfo } from "../../../shared/wordTemplate";
import { analyseTemplate, checkTemplate } from "./word/template";

/** Q-14: the company's Word template, which an admin uploads on the settings page. */

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

export async function templateInfo(db: Queryable): Promise<WordTemplateInfo> {
  const row = (await db.select().from(wordTemplates).where(eq(wordTemplates.inForce, true)))[0];
  return {
    current: row
      ? { id: row.id, fileName: row.fileName, sizeBytes: row.sizeBytes, uploadedAt: row.uploadedAt.toISOString(), uploadedBy: row.uploadedBy, found: row.found as TemplateFound }
      : null,
  };
}

/** The template new Word files are made from: the one in force, or the plain layout. */
export async function templateInForce(db: Queryable, storage: StoragePort): Promise<Buffer> {
  return (await templateWithId(db, storage)).data;
}
/** … with what names it, so that a review copy made from another template counts as another version (Q-13). */
export async function templateWithId(db: Queryable, storage: StoragePort): Promise<{ id: string; data: Buffer }> {
  const row = (await db.select({ id: wordTemplates.id, key: wordTemplates.storageKey }).from(wordTemplates).where(eq(wordTemplates.inForce, true)))[0];
  return row ? { id: row.id, data: await storage.get(row.key) } : { id: "plain", data: await plainTemplate() };
}

/** The template in force as uploaded, for an admin to check what is in use. */
export async function templateFile(db: Queryable, storage: StoragePort): Promise<{ fileName: string; data: Buffer }> {
  const row = (await db.select().from(wordTemplates).where(eq(wordTemplates.inForce, true)))[0];
  if (!row) throw new AppError(404, "no_template", "No company template has been uploaded; the app's plain layout is in use.");
  return { fileName: row.fileName, data: await storage.get(row.storageKey) };
}

const said = (f: TemplateFound) => {
  const marks = (["title", "date", "version"] as const).filter((m) => f.marks[m].length);
  return `${f.format === "dotx" ? "Word template" : "Word document"}; marks found: ${marks.length ? marks.map((m) => `[${m[0]!.toUpperCase()}${m.slice(1)}]`).join(", ") : "none"}`;
};

/** Q-14: an admin uploads a template. It replaces the one in force for files made from then on. Missing marks are reported, not refused. */
export async function uploadTemplate(ctx: { db: Db; storage: StoragePort }, file: { name: string; data: Buffer }, by: User): Promise<WordTemplateInfo> {
  const ext = /\.(dotx|docx)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!ext)
    throw new AppError(
      400,
      "wrong_file_type",
      /\.(dotm|docm|dot|doc)$/i.test(file.name)
        ? "That kind of Word file cannot be used. Save the template in Word as a Word Template (.dotx) or a Word Document (.docx) and upload that."
        : "Upload the template as a Word file: .dotx or .docx.",
    );
  if (file.data.length > MAX_TEMPLATE_BYTES)
    throw new AppError(400, "file_too_large", "That template is larger than 10 MB. A template with a logo is usually far smaller; check that it holds no large pictures.");
  const found = await analyseTemplate(file.data);
  await checkTemplate(file.data);
  const key = `templates/${randomUUID()}.${ext}`;
  await ctx.storage.put(key, file.data, "application/octet-stream");
  try {
    await ctx.db.transaction(async (tx) => {
      const before = (await tx.select().from(wordTemplates).where(eq(wordTemplates.inForce, true)).for("update"))[0];
      await tx.update(wordTemplates).set({ inForce: false }).where(eq(wordTemplates.inForce, true));
      await tx.insert(wordTemplates).values({ fileName: file.name, sizeBytes: file.data.length, storageKey: key, found, inForce: true, uploadedBy: by.email });
      await audit(tx, {
        userEmail: by.email,
        action: "update",
        entityType: "settings",
        entityId: "settings",
        summary: "Settings",
        changes: { "Word template": { from: before ? before.fileName : "the app's plain layout", to: `${file.name} (${said(found)})` } },
      });
    });
  } catch (e) {
    await ctx.storage.remove(key).catch(() => undefined);
    throw e;
  }
  return templateInfo(ctx.db);
}

/** Goes back to the app's plain layout. The uploaded templates stay on file. */
export async function usePlainLayout(db: Db, by: User): Promise<WordTemplateInfo> {
  await db.transaction(async (tx) => {
    const before = (await tx.select().from(wordTemplates).where(eq(wordTemplates.inForce, true)).orderBy(desc(wordTemplates.uploadedAt)).for("update"))[0];
    if (!before) return;
    await tx.update(wordTemplates).set({ inForce: false }).where(eq(wordTemplates.id, before.id));
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      entityType: "settings",
      entityId: "settings",
      summary: "Settings",
      changes: { "Word template": { from: before.fileName, to: "the app's plain layout" } },
    });
  });
  return templateInfo(db);
}
