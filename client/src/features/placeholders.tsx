import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { useWarnings } from "../lib/data";
import { list } from "../lib/motion";
import { hourNow, longDate } from "../lib/format";
import { useMe } from "../platform/session";
import { EmptyState, PageHeader } from "../platform/ui";
import { WarningRow } from "./warnings/WarningsPage";

export function DashboardPage() {
  const me = useMe();
  const warnings = useWarnings();
  const hour = hourNow();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const n = warnings.data?.length ?? 0;
  const headline = !warnings.data ? "" : n === 0 ? " Nothing needs a decision." : n === 1 ? " One thing could use a decision." : ` ${n} things could use a decision.`;
  return (
    <>
      <PageHeader context={longDate(new Date())} title={`${greeting}.${headline}`} />
      {n > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="flex-1 text-base font-semibold">Needs attention</h2>
            <Link to="/warnings" className="text-[13.5px] font-semibold text-accent-ink underline-offset-2 hover:underline">
              See all
            </Link>
          </div>
          <motion.ul variants={list} initial="initial" animate="animate" className="flex flex-col">
            {warnings.data!.slice(0, 6).map((w, i) => (
              <WarningRow key={`${w.type}-${w.agreementId ?? w.vendorId}-${i}`} w={w} />
            ))}
          </motion.ul>
        </section>
      )}
      <EmptyState title="More arrives here as the app grows">
        Spend against budgets, vendor scores and open RFPs will join this page as those parts are built.
        {me.role === "admin" && (
          <>
            {" "}
            You can check that everything is connected on the{" "}
            <Link to="/admin/system-check" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
              system check
            </Link>{" "}
            page.
          </>
        )}
      </EmptyState>
    </>
  );
}

const sections = {
  vendors: [
    "Vendors",
    "No vendors yet",
    "Every software vendor, consultancy and advisory firm the team works with will be listed here, each with its owner, contacts and paperwork.",
  ],
  agreements: [
    "Agreements",
    "No agreements yet",
    "MSAs, SOWs, subscriptions, NDAs and data processing agreements will be listed here, with their dates, values and renewal deadlines.",
  ],
  rfps: ["RFPs", "No RFPs yet", "Each RFP will be followed here from the approved demand through drafting, candidates, scoring and the decision."],
  ask: ["Ask", "Nothing to ask about yet", "You will be able to ask questions in plain language here, such as which SOWs end this quarter."],
} as const;

/** A section that a later milestone fills. It says what will live here. */
export function ComingSection({ name }: { name: keyof typeof sections }) {
  const [title, heading, body] = sections[name];
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title={heading}>{body} This part of the app has not been built yet.</EmptyState>
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="That page does not exist" />
      <EmptyState
        title="Nothing lives at this address"
        action={
          <Link to="/" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
            Back to the dashboard
          </Link>
        }
      >
        The link may be old, or the page may be for admins only.
      </EmptyState>
    </>
  );
}
