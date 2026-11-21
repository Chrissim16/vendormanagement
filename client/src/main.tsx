import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { AuditPage } from "./features/admin/AuditPage";
import { PeoplePage } from "./features/admin/PeoplePage";
import { SystemCheckPage } from "./features/admin/SystemCheckPage";
import { ImportPage } from "./features/admin/ImportPage";
import { SettingsPage } from "./features/admin/SettingsPage";
import { InvoicesPage, SpendPage } from "./features/invoices/MoneyPage";
import { AgreementPage } from "./features/agreements/AgreementPage";
import { AgreementsPage } from "./features/agreements/AgreementsPage";
import { RenewalsPage } from "./features/agreements/RenewalsPage";
import { ComingSection, DashboardPage, NotFoundPage } from "./features/placeholders";
import { VendorsPage } from "./features/vendors/VendorsPage";
import { WarningsPage } from "./features/warnings/WarningsPage";
import { Layout } from "./platform/Layout";
import { Session, useMe } from "./platform/session";
import "@fontsource-variable/inter";
import "./styles.css";

/** Admin pages do not exist for members. The server refuses them as well. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  return useMe().role === "admin" ? children : <NotFoundPage />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <DashboardPage /> },
      { path: "/vendors", element: <VendorsPage /> },
      { path: "/agreements", element: <AgreementsPage /> },
      { path: "/agreements/renewals", element: <RenewalsPage /> },
      { path: "/agreements/:id", element: <AgreementPage /> },
      { path: "/warnings", element: <WarningsPage /> },
      { path: "/money", element: <SpendPage /> },
      { path: "/money/invoices", element: <InvoicesPage /> },
      {
        path: "/admin/settings",
        element: (
          <AdminOnly>
            <SettingsPage />
          </AdminOnly>
        ),
      },
      { path: "/performance", element: <ComingSection name="performance" /> },
      { path: "/rfps", element: <ComingSection name="rfps" /> },
      { path: "/ask", element: <ComingSection name="ask" /> },
      {
        path: "/admin/import",
        element: (
          <AdminOnly>
            <ImportPage />
          </AdminOnly>
        ),
      },
      {
        path: "/admin/people",
        element: (
          <AdminOnly>
            <PeoplePage />
          </AdminOnly>
        ),
      },
      {
        path: "/admin/audit",
        element: (
          <AdminOnly>
            <AuditPage />
          </AdminOnly>
        ),
      },
      {
        path: "/admin/system-check",
        element: (
          <AdminOnly>
            <SystemCheckPage />
          </AdminOnly>
        ),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Session>
          <RouterProvider router={router} />
        </Session>
        <Toaster position="bottom-center" toastOptions={{ style: { background: "var(--ink)", color: "var(--bg)", border: "none", borderRadius: 11, fontWeight: 600 } }} />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
