import { Router } from "express";
import { currentUser } from "../../platform/auth";
import * as service from "./service";

/** C-1. The one address of the Ask feature: it reads, and keeps the answer it gave. */
export function chatRoutes(ctx: service.ChatContext) {
  const r = Router();
  r.post("/ask", async (req, res) => res.json(await service.askQuestion(ctx, req.body, currentUser(req))));
  return r;
}
