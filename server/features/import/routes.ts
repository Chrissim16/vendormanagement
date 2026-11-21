import { Router } from "express";
import type { Day } from "../../../shared/dates";
import { currentUser, requireRole } from "../../platform/auth";
import { AppError } from "../../platform/errors";
import type { Db } from "../../platform/ports/types";
import { upload } from "../agreements/routes";
import * as service from "./service";

export function importRoutes(db: Db, today: () => Day) {
  const r = Router();
  r.use(requireRole("admin"));
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
  return r;
}
