import { Router } from "express";
import { currentUser } from "../../platform/auth";
import { id } from "../../platform/http";
import * as service from "./service";

/** E-1: reading a contract's fields from a document attached to an agreement. */
export function readingRoutes(ctx: service.ReadingContext) {
  const r = Router();
  r.get("/agreements/:id/readings", async (req, res) => res.json(await service.listReadings(ctx, id.parse(req.params.id))));
  r.post("/documents/:id/reading", async (req, res) => res.status(201).json(await service.readDocument(ctx, id.parse(req.params.id), currentUser(req))));
  r.post("/documents/:id/reading/review", async (req, res) => res.json(await service.reviewReading(ctx, id.parse(req.params.id), req.body, currentUser(req))));
  return r;
}
