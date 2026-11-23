import { Router } from "express";
import type { Day } from "../../../shared/dates";
import { currentUser } from "../../platform/auth";
import { AppError } from "../../platform/errors";
import { upload } from "../../platform/http";
import type { Db } from "../../platform/ports/types";
import * as service from "./service";

export function importRoutes(db: Db, today: () => Day) {
  // A-8: open to every member since M13; each row is checked by the same rules as its form.
  const r = Router();
  r.get("/template.xlsx", async (_req, res) => {
    res
      .set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="vendorapp-import-template.xlsx"' })
      .send(await service.template());
  });
  const run = (apply: boolean) =>
    [
      upload.single("file"),
      async (req: Parameters<Parameters<typeof r.post>[1]>[0], res: Parameters<Parameters<typeof r.post>[1]>[1]) => {
        if (!req.file) throw new AppError(400, "file_missing", "Choose the filled-in template.");
        res.json(await service.importWorkbook(db, req.file.buffer, currentUser(req), today(), apply));
      },
    ] as const;
  r.post("/preview", ...run(false));
  r.post("/apply", ...run(true));
  r.post("/problems.xlsx", upload.single("file"), async (req, res) => {
    if (!req.file) throw new AppError(400, "file_missing", "Choose the filled-in template.");
    res
      .set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="vendorapp-import-rows-to-fix.xlsx"',
        "Cache-Control": "private, no-store",
      })
      .send(await service.problemRows(db, req.file.buffer, currentUser(req), today()));
  });
  return r;
}
