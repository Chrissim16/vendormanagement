import { Link } from "react-router-dom";
import { EmptyState, PageHeader } from "../platform/ui";

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
