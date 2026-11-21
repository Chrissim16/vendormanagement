import { eq, sql } from "drizzle-orm";
import { users, vendors } from "../schema";
import { addDays, type Day } from "../../shared/dates";
import type { AgreementInput } from "../../shared/agreements";
import type { VendorInput } from "../../shared/vendors";
import { toUser } from "../../server/platform/auth";
import type { Db } from "../../server/platform/ports/types";
import { createAgreement } from "../../server/features/agreements/service";
import { saveInvoice } from "../../server/features/invoices/service";
import { decideChange, getDelivery, saveChange, saveConsultant, saveMilestone, saveRateLine } from "../../server/features/sow/service";
import { saveLink, saveTargets, type PerformanceContext } from "../../server/features/performance/service";
import { generateProposal, reviewProposal } from "../../server/features/scorecards/proposals";
import { finaliseScorecard, saveScorecard, startScorecard, type ScorecardContext } from "../../server/features/scorecards/service";
import { addMonth, monthOf } from "../../shared/performance";
import { addQuarter, quarterBounds, quarterOf } from "../../shared/scorecards";
import { createVendor, saveContact } from "../../server/features/vendors/service";
import { jiraBoardLinks, scorecards } from "../schema";
import type { BoardLinkInput, Targets } from "../../shared/performance";

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
  /** Day rates per role: [role, rate in cents, days ago it started]. */
  rates?: [role: string, dayRateMinor: number, since: number][];
}

/** What happens on a SOW or subscription after it is signed. Amounts are in cents; days are relative to today. */
interface Delivery {
  /** A change approved before the milestones were planned: [title, budget change, new end in days from today]. */
  approvedChange?: [title: string, budgetChangeMinor: number, newEnd: number];
  proposedChange?: [title: string, budgetChangeMinor: number];
  /** [title, amount, due, delivered (omit while open)] */
  milestones?: [title: string, amountMinor: number | null, due: number, delivered?: number][];
  consultants?: [name: string, role: string][];
  /** [invoice number, amount, date, milestone title] */
  invoices?: [number: string, amountMinor: number, date: number, milestone?: string][];
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
      rates: [
        ["Lead architect", 1_250_00, 800],
        ["Lead architect", 1_350_00, 140],
        ["Data engineer", 980_00, 800],
        ["Service desk analyst", 520_00, 800],
      ],
      agreements: [
        { kind: "msa", title: "Master services agreement", status: "active", signedOn: d(-990) },
        {
          kind: "sow",
          title: "SOW 07 Ledger migration",
          under: "Master services agreement",
          status: "active",
          signedOn: d(-230),
          startDate: d(-225),
          endDate: d(9),
          pricing: "fixed",
          budgetMinor: 210_000_00,
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
      rates: [
        ["Senior consultant", 1_450_00, 440],
        ["Analyst", 890_00, 440],
      ],
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

/** Milestones, changes, consultants and invoices for the sample agreements, by agreement title. Invented, like everything here. */
const sampleDelivery: Record<string, Delivery> = {
  "SOW 07 Ledger migration": {
    approvedChange: ["Extra entity in scope", 30_000_00, 99],
    proposedChange: ["Extended hypercare", 12_000_00],
    milestones: [
      ["Design sign-off", 42_000_00, -220, -222],
      ["Data model and mapping", 58_000_00, -144, -144],
      ["First trial migration", 60_000_00, -52, -33],
      ["Parallel run", 45_000_00, 55],
      ["Go-live and handover", 35_000_00, 99],
    ],
    consultants: [
      ["Alex Example", "Lead architect"],
      ["Robin Sample", "Data engineer"],
    ],
    invoices: [
      ["BF-2026-014", 42_000_00, -215, "Design sign-off"],
      ["BF-2026-031", 58_000_00, -140, "Data model and mapping"],
      ["BF-2026-058", 60_000_00, -30, "First trial migration"],
      ["BF-2026-061", 15_000_00, -24],
      ["BF-2026-066", 14_200_00, -12],
      ["BF-2026-070", 10_000_00, -3],
    ],
  },
  "SOW 09 Helpdesk run": {
    consultants: [["Sam Placeholder", "Service desk analyst"]],
    invoices: Array.from({ length: 9 }, (_, n): [string, number, number] => [`BF-RUN-${String(n + 1).padStart(2, "0")}`, 8_200_00, -270 + n * 30]),
  },
  "SOW 02 Close process review": {
    milestones: [
      ["Current state report", null, -60, -58],
      ["Recommendations", null, 10],
    ],
    consultants: [["Jo Specimen", "Senior consultant"]],
    invoices: [
      ["QC-1101", 14_000_00, -80],
      ["QC-1117", 14_000_00, -50],
      ["QC-1130", 14_000_00, -20],
    ],
  },
  "Reporting suite": { invoices: [["TW-88213", 48_000_00, -284]] },
  "Service desk licence": { invoices: [["MG-5521", 26_400_00, -248]] },
  "Data platform licence": { invoices: [["SC-00917", 31_500_00, -115]] },
  "Research membership": { invoices: [["EA-2026-77", 62_000_00, -65]] },
};

/**
 * Which invented Jira board each helpdesk vendor uses, how escalation shows on it, and the
 * targets from its contract, in tenths. One board escalates by status, one by label.
 */
const sampleBoards: Record<string, { link: Omit<BoardLinkInput, "active">; targets: Partial<Targets> }> = {
  "Bluefinch Systems": {
    link: {
      projectKey: "BLU",
      escalationMethod: "status",
      l1Values: ["Waiting for support", "In progress"],
      l2Values: ["Escalated to second line"],
      l3Values: ["With vendor engineering"],
    },
    targets: { first_response: 950, first_line: 650, sla_breaches: 100, backlog_age: 300, csat: 40 },
  },
  "Mossgate IT": {
    link: { projectKey: "MOS", escalationMethod: "label", l1Values: [], l2Values: ["tier-2"], l3Values: ["tier-3"] },
    targets: { first_response: 950, first_line: 750, sla_breaches: 50, backlog_age: 300, csat: 42 },
  },
  "Tarnwick Software": {
    link: {
      projectKey: "TAR",
      escalationMethod: "status",
      l1Values: ["Waiting for support", "In progress"],
      l2Values: ["Escalated to second line"],
      l3Values: ["With vendor engineering"],
    },
    targets: { first_response: 900, first_line: 600 },
  },
};

/** Links the sample helpdesk vendors to the stand-in Jira's boards and fetches their invented tickets. */
async function seedPerformance(perf: PerformanceContext, admin: ReturnType<typeof toUser>) {
  if (perf.jira.kind !== "stand-in") return;
  if ((await perf.db.select({ n: sql<number>`count(*)::int` }).from(jiraBoardLinks))[0]!.n > 0) return;
  for (const [name, sample] of Object.entries(sampleBoards)) {
    const vendor = (await perf.db.select({ id: vendors.id }).from(vendors).where(eq(vendors.name, name)))[0];
    if (!vendor) continue;
    await saveLink(perf, vendor.id, sample.link, admin);
    await saveTargets(perf, vendor.id, sample.targets, admin);
  }
}

/**
 * AI proposals for the months since the start of last quarter (some reviewed, the latest
 * left for someone to look at), and three scorecards for last quarter: a final one for a
 * helpdesk vendor, a final one scored entirely by hand, and a draft waiting to be scored.
 */
async function seedScorecards(ctx: ScorecardContext, today: Day) {
  if (ctx.perf.jira.kind !== "stand-in" || ctx.ai.kind !== "stand-in") return;
  if ((await ctx.db.select({ n: sql<number>`count(*)::int` }).from(scorecards))[0]!.n > 0) return;
  const person = async (email: string) => toUser((await ctx.db.select().from(users).where(eq(users.email, email)))[0]!);
  const vendorId = async (name: string) => (await ctx.db.select({ id: vendors.id }).from(vendors).where(eq(vendors.name, name)))[0]?.id;
  const mira = await person("mira@example.test");
  const sanne = await person("sanne@example.test");
  const quarter = addQuarter(quarterOf(today), -1);
  const months: string[] = [];
  for (let m = quarterBounds(quarter).months[0] as string; m < monthOf(today); m = addMonth(m, 1)) months.push(m);

  for (const name of Object.keys(sampleBoards)) {
    const id = await vendorId(name);
    if (!id) continue;
    for (const month of months) {
      const proposal = await generateProposal(ctx, id, month, "system").catch(() => null);
      // Last quarter's proposals have been looked at for two of the three vendors; the newest month is still waiting everywhere.
      if (proposal && name !== "Tarnwick Software" && quarterBounds(quarter).months.includes(month)) await reviewProposal(ctx, proposal.id, { action: "accept" }, mira);
    }
  }

  const comments: Record<string, [score: number, forVendor: string, internal: string]> = {
    "Responsiveness and communication": [
      4,
      "Monthly service reviews were held on time and questions were answered within a day.",
      "Account manager changed in the quarter; keep an eye on continuity.",
    ],
    "Value for money": [4, "Costs stayed within what was agreed.", "Raise the price index clause before the next renewal."],
    "Compliance and security": [5, "All agreements are in place and the yearly security statement was received.", ""],
    "Quality of delivery": [4, "Deliverables were accepted without rework.", ""],
    Timeliness: [3, "One delivery was later than planned.", "The delay was partly ours: the test environment was late."],
  };
  const helpdesk: Record<string, string> = {
    "Quality of delivery": "Most tickets were solved by the first line and users rated the service well.",
    Timeliness: "First response was on target in July; August and September need attention.",
  };
  const score = async (name: string, by: typeof mira, finalise: boolean, only?: string[]) => {
    const id = await vendorId(name);
    if (!id) return;
    const card = await startScorecard(ctx, { vendorId: id, quarter }, by);
    const lines = card.lines
      .filter((l) => !only || only.includes(l.name))
      .map((l) => {
        const [manual, vendorComment, internalNote] = comments[l.name] ?? [3, "", ""];
        // Where the AI has a suggestion it is accepted as it is; everything else is scored by hand.
        return {
          criterionId: l.criterionId,
          score: l.suggestion?.score ?? manual,
          vendorComment: l.suggestion ? (helpdesk[l.name] ?? "") : vendorComment,
          internalNote: l.suggestion ? "" : internalNote,
          acceptedSuggestion: !!l.suggestion,
        };
      });
    await saveScorecard(ctx, card.id, { lines, summary: finalise ? "A steady quarter. The points below were discussed in the service review." : undefined }, by);
    if (finalise) await finaliseScorecard(ctx, card.id, by);
  };
  await score("Mossgate IT", mira, true);
  await score("Quillon Consulting", sanne, true);
  await score("Bluefinch Systems", mira, false, ["Compliance and security"]);
}

/** Loads the sample people, vendors, agreements, helpdesk boards, AI proposals and scorecards. Safe to run more than once. */
export async function seed(db: Db, today: Day, ctx?: ScorecardContext) {
  await seedCore(db, today);
  if (ctx) {
    const admin = (await db.select().from(users).where(eq(users.email, "admin@example.test")))[0];
    if (admin) await seedPerformance(ctx.perf, toUser(admin));
    await seedScorecards(ctx, today);
  }
}

async function seedCore(db: Db, today: Day) {
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
    // Every sample vendor says in its legal name that it is made up, so it can never be mistaken for a real firm.
    const vendor = await createVendor(db, { legalName: `${s.vendor.name} (invented)`, ...s.vendor, ownerUserId: idOf(s.owner) }, admin, today);
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
    for (const [role, dayRateMinor, since] of s.rates ?? [])
      await saveRateLine(db, { vendorId: vendor.id }, { role, dayRateMinor, validFrom: addDays(today, -since) }, admin, today);
    for (const [title, id] of made) {
      const plan = sampleDelivery[title];
      if (!plan) continue;
      const day = (n: number) => addDays(today, n);
      if (plan.approvedChange) {
        const [changeTitle, budgetChangeMinor, newEnd] = plan.approvedChange;
        const after = await saveChange(db, { sowId: id }, { title: changeTitle, requestedOn: day(-70), budgetChangeMinor, newEndDate: day(newEnd) }, admin, today);
        await decideChange(db, after.changeRequests.at(-1)!.id, "approved", admin, today);
      }
      for (const [mTitle, amountMinor, due, delivered] of plan.milestones ?? []) {
        await saveMilestone(
          db,
          { sowId: id },
          { title: mTitle, amountMinor, dueDate: day(due), ...(delivered === undefined ? {} : { status: "delivered", deliveredOn: day(delivered) }) },
          admin,
          today,
        );
      }
      if (plan.proposedChange)
        await saveChange(db, { sowId: id }, { title: plan.proposedChange[0], requestedOn: day(-6), budgetChangeMinor: plan.proposedChange[1] }, admin, today);
      for (const [name, role] of plan.consultants ?? []) await saveConsultant(db, { sowId: id }, { name, role }, admin, today);
      const milestoneIds = plan.milestones ? new Map((await getDelivery(db, id, today)).milestones.map((m) => [m.title, m.id])) : new Map<string, string>();
      for (const [invoiceNumber, amountMinor, date, milestone] of plan.invoices ?? []) {
        await saveInvoice(
          db,
          null,
          { agreementId: id, invoiceNumber, amountMinor, invoiceDate: day(date), milestoneId: milestone ? milestoneIds.get(milestone) : null },
          admin,
          today,
        );
      }
    }
  }
  // Tie the people to a known state for anyone re-seeding.
  await db.update(users).set({ active: false }).where(eq(users.email, "former@example.test"));
}
