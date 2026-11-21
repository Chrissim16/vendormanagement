import { describe, expect, it } from "vitest";
import { diff, refuseUserChange } from "./users";

describe("there is always at least one active admin", () => {
  const admin = { role: "admin" as const, active: true };
  it("refuses demoting the last admin", () => {
    expect(refuseUserChange(admin, { role: "member" }, 0)).toMatch(/last admin/);
  });
  it("refuses switching off the last admin", () => {
    expect(refuseUserChange(admin, { active: false }, 0)).toMatch(/last admin/);
  });
  it("allows both when another active admin exists", () => {
    expect(refuseUserChange(admin, { role: "member" }, 1)).toBeNull();
    expect(refuseUserChange(admin, { active: false }, 1)).toBeNull();
  });
  it("never blocks changes to a member or to an inactive admin", () => {
    expect(refuseUserChange({ role: "member", active: true }, { active: false }, 0)).toBeNull();
    expect(refuseUserChange({ role: "admin", active: false }, { role: "member" }, 0)).toBeNull();
  });
  it("allows a change that keeps the last admin an active admin", () => {
    expect(refuseUserChange(admin, { role: "admin", active: true }, 0)).toBeNull();
  });
});

describe("diff", () => {
  it("lists only the fields that changed", () => {
    expect(diff({ role: "member", active: true }, { role: "admin", active: true })).toEqual({ role: { from: "member", to: "admin" } });
  });
});
