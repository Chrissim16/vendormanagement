import { eq, sql } from "drizzle-orm";
import { users, vendors } from "../schema";
import { addDays, type Day } from "../../shared/dates";
import type { AgreementInput } from "../../shared/agreements";
import type { VendorInput } from "../../shared/vendors";
import { toUser } from "../../server/platform/auth";
import type { Db } from "../../server/platform/ports/types";
import { createAgreement } from "../../server/features/agreements/service";
import { createVendor, saveContact } from "../../server/features/vendors/service";

/** Invented people only. Never real names or addresses. */
export const seedUsers = [
  { email: "admin@example.test", displayName: "Alex Admin", role: "admin" as const, active: true },
  { email: "mira@example.test", displayName: "Mira Okafor", role: "member" as const, active: true },
  { email: "jonas@example.test", displayName: "Jonas Brandt", role: "member" as const, active: true },
  { email: "sanne@example.test", displayName: "Sanne de Wit", role: "member" as const, active: true },
  { email: "former@example.test", displayName: "Former Colleague", role: "member" as const, active: false },
];

type A = Partial<AgreementInput> & Pick<AgreementInput, "kind" | "title">;
interface SeedVendor {
  vendor: Partial<VendorInput> & Pick<VendorInput, "name" | "type">;
  owner: string;
  contact?: [name: string, jobTitle: string];
  agreements: (A & { under?: string })[];
}

/**
 * Invented vendors and agreements, dated relative to today so that every kind of warning
 * has an example. The names are made up; none is meant to be a real company.
 */
function sampleVendors(today: Day): SeedVendor[] {
  const d = (n: number) => addDays(today, n);
  const paper = (signed: number): A[] => [
    { kind: "nda", title: "Mutual NDA", status: "active", signedOn: d(signed) },
    { kind: "dpa", title: "Data processing agreement", status: "active", signedOn: d(signed) },
  ];
  const sub = (title: string, renewsIn: number, value: number, o: Partial<A> = {}): A => ({
    kind: "subscription",
    title,
    status: "active",
    signedOn: d(renewsIn - 365),
    startDate: d(renewsIn - 365),
    endDate: d(renewsIn),
    annualValueMinor: value,
    noticePeriodDays: 90,
    autoRenews: true,
    ...o,
  });
  return [
    {
      vendor: { name: "Bluefinch Systems", type: "software", legalName: "Bluefinch Systems B.V. (invented)", country: "NL", website: "https://bluefinch.example.test" },
      owner: "mira@example.test",
      contact: ["Lena Hartog", "Service Director"],
      agreements: [
        { kind: "msa", title: "Master services agreement", status: "active", signedOn: d(-990) },
        {
          kind: "sow",
          title: "SOW 07 Ledger migration",
          under: "Master services agreement",
          status: "active",
          signedOn: d(-230),
          startDate: d(-225),
          endDate: d(99),
          pricing: "fixed",
          budgetMinor: 240_000_00,
        },
        {
          kind: "sow",
          title: "SOW 09 Helpdesk run",
          under: "Master services agreement",
          status: "active",
          signedOn: d(-330),
          startDate: d(-325),
          endDate: d(405),
          pricing: "time_and_materials",
          budgetMinor: 180_000_00,
        },
        {
          kind: "sow",
          title: "SOW 04 Discovery",
          under: "Master services agreement",
          status: "ended",
          endReason: "completed",
          signedOn: d(-700),
          startDate: d(-690),
          endDate: d(-520),
          pricing: "fixed",
          budgetMinor: 38_000_00,
        },
        ...paper(-1000),
      ],
    },
    {
      vendor: { name: "Quillon Consulting", type: "consultancy", country: "NL" },
      owner: "sanne@example.test",
      contact: ["Pieter Aalto", "Partner"],
      agreements: [
        { kind: "msa", title: "Framework agreement", status: "active", signedOn: d(-440) },
        {
          kind: "sow",
          title: "SOW 02 Close process review",
          under: "Framework agreement",
          status: "active",
          signedOn: d(-120),
          startDate: d(-110),
          endDate: d(18),
          pricing: "time_and_materials",
          budgetMinor: 64_000_00,
        },
        {
          kind: "sow",
          title: "SOW 03 Treasury roadmap",
          under: "Framework agreement",
          status: "out_for_signature",
          startDate: d(30),
          endDate: d(210),
          pricing: "fixed",
          budgetMinor: 95_000_00,
        },
        ...paper(-450),
      ],
    },
    {
      vendor: { name: "Tarnwick Software", type: "software", country: "DE" },
      owner: "jonas@example.test",
      contact: ["Ruth Emery", "Customer Success"],
      agreements: [sub("Reporting suite", 81, 48_000_00), ...paper(-2000)],
    },
    {
      vendor: { name: "Mossgate IT", type: "software", country: "NL" },
      owner: "mira@example.test",
      contact: ["Dana Whitlow", "Account Lead"],
      agreements: [
        sub("Service desk licence", 117, 26_400_00),
        { kind: "nda", title: "Mutual NDA", status: "active", signedOn: d(-1700) },
        { kind: "dpa", title: "Data processing agreement", status: "active", signedOn: d(-1100), endDate: d(-12) },
      ],
    },
    {
      vendor: { name: "Sedgewater Cloud", type: "software", country: "GB" },
      owner: "jonas@example.test",
      contact: ["Sam Idris", "Account Manager"],
      agreements: [sub("Data platform licence", 250, 31_500_00, { currency: "GBP", autoRenews: false }), ...paper(-740)],
    },
    {
      vendor: { name: "Emberline Advisory", type: "advisory", scoringEnabled: false, dpaRequired: false, country: "GB" },
      owner: "sanne@example.test",
      agreements: [sub("Research membership", 300, 62_000_00, { noticePeriodDays: 60 }), { kind: "nda", title: "NDA", status: "active", signedOn: d(-2400) }],
    },
    {
      vendor: { name: "Larkspur Data", type: "software", country: "NL" },
      owner: "jonas@example.test",
      agreements: [
        { kind: "dpa", title: "Data processing agreement", status: "active", signedOn: d(-200) },
        { kind: "nda", title: "Mutual NDA", status: "in_negotiation" },
      ],
    },
    {
      vendor: { name: "Pellham Analytics", type: "software", status: "on_hold", country: "NL" },
      owner: "jonas@example.test",
      agreements: [{ kind: "nda", title: "Mutual NDA", status: "active", signedOn: d(-500) }],
    },
    {
      vendor: { name: "Harrowick Partners", type: "consultancy", status: "prospect", country: "NL" },
      owner: "sanne@example.test",
      contact: ["Noor Castell", "Partner"],
      agreements: [],
    },
  ];
}

/** Loads the sample people, vendors and agreements. Safe to run more than once. */
export async function seed(db: Db, today: Day) {
  await db
    .insert(users)
    .values(seedUsers.map((u) => ({ ...u, createdBy: "seed", updatedBy: "seed" })))
    .onConflictDoNothing();
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(vendors);
  if ((existing[0]?.n ?? 0) > 0) return;
  const people = await db.select().from(users);
  const idOf = (email: string) => people.find((u) => u.email === email)!.id;
  const admin = toUser(people.find((u) => u.email === "admin@example.test")!);
  for (const s of sampleVendors(today)) {
    const vendor = await createVendor(db, { ...s.vendor, ownerUserId: idOf(s.owner) }, admin, today);
    if (s.contact)
      await saveContact(
        db,
        { vendorId: vendor.id },
        {
          name: s.contact[0],
          jobTitle: s.contact[1],
          email: `${s.contact[0].split(" ")[0]!.toLowerCase()}@${s.vendor.name.split(" ")[0]!.toLowerCase()}.example.test`,
          isPrimary: true,
        },
        admin,
      );
    const made = new Map<string, string>();
    for (const { under, ...a } of s.agreements) {
      const created = await createAgreement(db, { ...a, vendorId: vendor.id, ownerUserId: idOf(s.owner), parentMsaId: under ? made.get(under) : null }, admin, today);
      made.set(a.title, created.id);
    }
  }
  // Tie the people to a known state for anyone re-seeding.
  await db.update(users).set({ active: false }).where(eq(users.email, "former@example.test"));
}
