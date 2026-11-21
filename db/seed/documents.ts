import { and, eq, sql } from "drizzle-orm";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";
import { addDocument } from "../../server/features/agreements/service";
import type { Db, StoragePort } from "../../server/platform/ports/types";
import { formatDay, type Day } from "../../shared/dates";
import type { User } from "../../shared/types";
import { agreements, documents, vendors } from "../schema";

// Invented contract texts, so that questions about what a document says have something to find. No real agreement was used.

const bluefinchMsa: { heading: string; pages: [clause: string, text: string][][] } = {
  heading: "Master services agreement (invented sample)",
  pages: [
    [
      ["Parties", "This agreement is between the Finance IT team (the Customer) and Bluefinch Systems B.V. (invented) (the Supplier)."],
      [
        "1. Services",
        "The Supplier provides the services described in each statement of work signed under this agreement. A statement of work says what is delivered, by when and at what price.",
      ],
      [
        "2. Fees and payment",
        "Invoices are payable within 30 days of the invoice date. Day rates are fixed for twelve months from signature and may then rise by at most 3% a year.",
      ],
      [
        "3. Service levels",
        "The Supplier answers every helpdesk ticket within four working hours and reports on its service levels each month. Where a service level is missed in two months running, the parties agree a recovery plan.",
      ],
    ],
    [
      [
        "4. Liability",
        "The Supplier's total liability under this agreement in any contract year is limited to 150% of the fees paid in that year. Neither party is liable for indirect or consequential loss.",
      ],
      [
        "5. Termination",
        "Either party may terminate this agreement by giving 90 days' written notice. The Customer may terminate a statement of work by giving 30 days' written notice.",
      ],
      ["6. Confidentiality", "Each party keeps the other's information confidential for five years after this agreement ends."],
      ["7. Governing law", "This agreement is governed by the laws of the Netherlands. Disputes go to the court of Amsterdam."],
    ],
  ],
};

const quillonFramework: [clause: string, text: string][] = [
  ["Parties", "This framework agreement is between the Finance IT team (the Customer) and Quillon Consulting (invented) (the Consultancy)."],
  ["Staffing", "A named consultant is replaced only with the Customer's consent. The Consultancy gives four weeks' notice of a change of consultant."],
  ["Travel", "Travel expenses are charged at cost and need the Customer's approval in advance above EUR 500 per trip."],
  ["Liability", "The Consultancy's liability is limited to the fees of the statement of work concerned, with a maximum of EUR 250,000 per event."],
  ["Termination", "Either party may end this agreement by giving 60 days' written notice. Work in progress is handed over and invoiced up to the end date."],
];

/** A PDF of headed clauses, one list of clauses per page. */
function pdf(heading: string, pages: [clause: string, text: string][][]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 64, info: { Title: heading } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    pages.forEach((clauses, i) => {
      if (i > 0) doc.addPage();
      else doc.font("Helvetica-Bold").fontSize(16).text(heading).moveDown();
      for (const [clause, text] of clauses) {
        if (clause) doc.font("Helvetica-Bold").fontSize(11).text(clause);
        doc.font("Helvetica").fontSize(11).text(text).moveDown();
      }
    });
    doc.end();
  });
}

/** "10 February 2027": a date as a contract writes it. */
const longDay = (day: Day) => {
  const [d, , y] = formatDay(day).split(" ");
  return `${d} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(day.slice(5, 7)) - 1]} ${y}`;
};

/**
 * An order form for a subscription that says two things differently from what was keyed
 * in (the yearly fee and the notice period), so that contract reading has something to find.
 */
const orderForm = (a: { signedOn: Day; startDate: Day; endDate: Day }): [string, string][][] => [
  [
    ["", "Subscription: Reporting suite"],
    ["Parties", "This order form is between the Finance IT team (the Customer) and Tarnwick Software (invented) (the Supplier)."],
    [
      "Term",
      `This order form was signed on ${longDay(a.signedOn)}. The subscription starts on ${longDay(a.startDate)}. It renews on ${longDay(a.endDate)} for a further twelve months unless cancelled.`,
    ],
    ["Fees", "The annual fee is € 51,000.00, invoiced yearly in advance."],
    ["Cancelling", "Either party may cancel the subscription by giving 60 days' written notice before the renewal date."],
  ],
];

const word = () =>
  Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Framework agreement (invented sample)", heading: HeadingLevel.TITLE }),
            ...quillonFramework.flatMap(([clause, text]) => [new Paragraph({ text: clause, heading: HeadingLevel.HEADING_2 }), new Paragraph({ text })]),
          ],
        },
      ],
    }),
  );

/** Attaches two invented contracts to sample agreements, through the same function the Attach button uses. Does nothing once any document exists. */
export async function seedDocuments(db: Db, storage: StoragePort, by: User) {
  if ((await db.select({ n: sql<number>`count(*)::int` }).from(documents))[0]!.n > 0) return;
  const agreementId = async (vendor: string, title: string) =>
    (
      await db
        .select({ id: agreements.id })
        .from(agreements)
        .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
        .where(and(eq(vendors.name, vendor), eq(agreements.title, title)))
    )[0]?.id;
  const [msa, framework] = [await agreementId("Bluefinch Systems", "Master services agreement"), await agreementId("Quillon Consulting", "Framework agreement")];
  if (msa) await addDocument(db, storage, msa, { name: "Bluefinch MSA (invented sample).pdf", data: await pdf(bluefinchMsa.heading, bluefinchMsa.pages) }, by);
  const suite = (
    await db
      .select({ id: agreements.id, signedOn: agreements.signedOn, startDate: agreements.startDate, endDate: agreements.endDate })
      .from(agreements)
      .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
      .where(and(eq(vendors.name, "Tarnwick Software"), eq(agreements.title, "Reporting suite")))
  )[0];
  if (suite?.signedOn && suite.startDate && suite.endDate)
    await addDocument(
      db,
      storage,
      suite.id,
      {
        name: "Tarnwick order form (invented sample).pdf",
        data: await pdf("Order form (invented sample)", orderForm({ signedOn: suite.signedOn, startDate: suite.startDate, endDate: suite.endDate })),
      },
      by,
    );
  if (framework) await addDocument(db, storage, framework, { name: "Quillon framework agreement (invented sample).docx", data: await word() }, by);
}
