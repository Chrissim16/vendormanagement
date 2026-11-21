import { and, eq, sql } from "drizzle-orm";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";
import { addDocument } from "../../server/features/agreements/service";
import type { Db, StoragePort } from "../../server/platform/ports/types";
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

function pdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 64, info: { Title: bluefinchMsa.heading } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    bluefinchMsa.pages.forEach((clauses, i) => {
      if (i > 0) doc.addPage();
      else doc.font("Helvetica-Bold").fontSize(16).text(bluefinchMsa.heading).moveDown();
      for (const [clause, text] of clauses) {
        doc.font("Helvetica-Bold").fontSize(11).text(clause);
        doc.font("Helvetica").fontSize(11).text(text).moveDown();
      }
    });
    doc.end();
  });
}

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
  if (msa) await addDocument(db, storage, msa, { name: "Bluefinch MSA (invented sample).pdf", data: await pdf() }, by);
  if (framework) await addDocument(db, storage, framework, { name: "Quillon framework agreement (invented sample).docx", data: await word() }, by);
}
