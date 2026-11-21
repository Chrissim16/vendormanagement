import clsx from "clsx";
import { Activity, Bell, Building2, Coins, FileText, FileUp, House, type LucideIcon, MessageSquare, Moon, ScrollText, Search, Settings, TrendingUp, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useOutlet } from "react-router-dom";
import { useWarnings } from "../lib/data";
import { bouncy, page, spring } from "../lib/motion";
import { toggleTheme } from "../lib/theme";
import { DevSwitcher, useMe } from "./session";
import { IconButton } from "./ui";

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
}
const main: Item[] = [
  { to: "/", label: "Dashboard", icon: House },
  { to: "/vendors", label: "Vendors", icon: Building2 },
  { to: "/agreements", label: "Agreements", icon: FileText },
  { to: "/money", label: "Money", icon: Coins },
  { to: "/performance", label: "Performance", icon: TrendingUp },
  { to: "/rfps", label: "RFPs", icon: MessageSquare },
  { to: "/ask", label: "Ask", icon: Search },
];
const admin: Item[] = [
  { to: "/admin/people", label: "People", icon: Users },
  { to: "/admin/import", label: "Import", icon: FileUp },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
  { to: "/admin/system-check", label: "System check", icon: Activity },
];

function NavItem({ to, label, icon: Icon }: Item) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        clsx("group relative flex h-[38px] items-center gap-[11px] rounded-[9px] px-3 font-medium transition-colors", isActive ? "text-ink" : "text-ink-2 hover:text-ink")
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span layoutId="nav-pill" transition={bouncy} className="absolute inset-0 rounded-[9px] bg-surface shadow-[0_0_0_1px_var(--line),0_2px_6px_rgba(9,20,45,.05)]" />
          )}
          <Icon size={16} strokeWidth={1.7} aria-hidden className="relative transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
          <span className="relative">{label}</span>
        </>
      )}
    </NavLink>
  );
}

const hints = ["Search vendors, agreements, invoices", "Try “SOWs ending this quarter”", "Try “who has no NDA”"];

/** Placeholder until search arrives with the Ask milestone; the hints slide to show what it will do. */
function SearchHint() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % hints.length), 3200);
    return () => clearInterval(t);
  }, []);
  return (
    <div aria-hidden className="flex h-[38px] max-w-[420px] flex-1 items-center gap-2.5 overflow-hidden rounded-full bg-sunk px-4 text-ink-2">
      <Search size={15} />
      <div className="relative h-5 flex-1">
        <AnimatePresence initial={false}>
          <motion.span key={i} className="absolute inset-0 truncate leading-5" initial={{ y: 20 }} animate={{ y: 0 }} exit={{ y: -20 }} transition={spring}>
            {hints[i]}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Layout() {
  const me = useMe();
  const location = useLocation();
  const outlet = useOutlet();
  const warnings = useWarnings().data?.length ?? 0;
  const [hops, setHops] = useState(0);
  useEffect(() => setHops((n) => n + 1), [location.pathname]);
  const initials = (me.displayName ?? me.email)
    .split(/[\s.@]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div className="grid h-full grid-cols-[236px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-6 border-r border-line bg-rail px-3.5 py-[22px]">
        <div className="flex items-center gap-2.5 px-2.5 font-bold tracking-[-0.01em]">
          <motion.i
            aria-hidden
            className="block h-3.5 w-3.5 rounded bg-accent"
            animate={{ rotate: hops * 180, y: [0, -9, 0] }}
            transition={{ rotate: bouncy, y: { duration: 0.45, ease: "easeOut" } }}
          />
          vendorapp
        </div>
        <nav aria-label="Sections" className="flex flex-col gap-0.5">
          {main.map((i) => (
            <NavItem key={i.to} {...i} />
          ))}
        </nav>
        {me.role === "admin" && (
          <nav aria-label="Admin" className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-[12px] font-medium text-ink-3">Admin</p>
            {admin.map((i) => (
              <NavItem key={i.to} {...i} />
            ))}
          </nav>
        )}
        <div className="mt-auto flex flex-col gap-4">
          <DevSwitcher current={me.email} />
          <div className="flex items-center gap-2.5 px-2.5 text-[13px] text-ink-2">
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-on">
              {initials}
            </span>
            <span className="min-w-0">
              <span data-testid="me-name" className="block truncate font-medium text-ink">
                {me.displayName ?? me.email}
              </span>
              <span data-testid="me-role" className="block">
                {me.role === "admin" ? "Admin" : "Member"}
              </span>
            </span>
          </div>
        </div>
      </aside>

      <div className="flex h-full min-w-0 flex-col">
        <header className="flex items-center gap-2.5 border-b border-line px-10 py-4">
          <SearchHint />
          <span className="flex-1" />
          <IconButton label="Switch between light and dark" onClick={toggleTheme}>
            <Moon size={17} aria-hidden />
          </IconButton>
          <Link
            to="/warnings"
            aria-label={warnings ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : "No warnings"}
            title="Warnings"
            className="relative grid h-[38px] w-[38px] place-items-center rounded-full text-ink-2 transition duration-200 hover:bg-sunk hover:text-ink active:scale-90"
          >
            <Bell size={17} aria-hidden />
            {warnings > 0 && (
              <span
                data-testid="warning-count"
                aria-hidden
                className="num absolute right-0.5 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--crit-strong)] px-1 text-[10px] font-semibold text-white"
              >
                {warnings}
              </span>
            )}
          </Link>
        </header>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.main key={location.pathname} {...page} className="absolute inset-0 overflow-auto px-10 pb-[72px] pt-11">
              <div className="mx-auto flex max-w-[1120px] flex-col gap-10">{outlet}</div>
            </motion.main>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
