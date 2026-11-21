import { Link } from "react-router-dom";
import { EmptyState, PageHeader } from "../platform/ui";

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
