import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { AuditPage } from "./features/admin/AuditPage";
import { PeoplePage } from "./features/admin/PeoplePage";
import { SystemCheckPage } from "./features/admin/SystemCheckPage";
import { ComingSection, DashboardPage, NotFoundPage } from "./features/placeholders";
import { Layout } from "./platform/Layout";
import { Session, useMe } from "./platform/session";
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
      { path: "/vendors", element: <ComingSection name="vendors" /> },
      { path: "/agreements", element: <ComingSection name="agreements" /> },
      { path: "/money", element: <ComingSection name="money" /> },
      { path: "/performance", element: <ComingSection name="performance" /> },
      { path: "/rfps", element: <ComingSection name="rfps" /> },
      { path: "/ask", element: <ComingSection name="ask" /> },
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
