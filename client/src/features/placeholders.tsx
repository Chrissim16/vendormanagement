import { Link } from "react-router-dom";
import { hourNow, longDate } from "../lib/format";
import { useMe } from "../platform/session";
import { EmptyState, PageHeader } from "../platform/ui";

export function DashboardPage() {
  const me = useMe();
  const hour = hourNow();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <PageHeader context={longDate(new Date())} title={`${greeting}. Nothing needs a decision yet.`} />
      <EmptyState title="This is where your day starts">
        Once vendors and agreements are in, this page shows renewals coming up, SOWs close to their budget, missing paperwork and how each vendor is scoring.
        {me.role === "admin" && (
          <>
            {" "}
            For now, you can check that everything is connected on the{" "}
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
  money: ["Money", "No invoices yet", "Invoices keyed in against a SOW or subscription will show here as spend per vendor and per month, next to each budget."],
  performance: ["Performance", "No scores yet", "Monthly helpdesk figures from Jira and the quarterly scorecards for each vendor will show here."],
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
