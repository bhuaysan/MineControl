import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { useServers } from "../hooks/useServers.js";
import { LanguageSwitcher } from "./LanguageSwitcher.js";
import { StatusDot } from "./StatusBadge.js";

interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", labelKey: "dashboard", icon: "▣" },
  { to: "/networks", labelKey: "networks", icon: "🕸" },
  { to: "/players", labelKey: "players", icon: "👥" },
  { to: "/users", labelKey: "users", icon: "👤", adminOnly: true },
  { to: "/audit", labelKey: "audit", icon: "📋", adminOnly: true },
  { to: "/settings", labelKey: "settings", icon: "⚙" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation("nav");
  const { user, logout, can } = useAuth();
  const { data: servers } = useServers();
  const [mobileOpen, setMobileOpen] = useState(false);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
      isActive
        ? "bg-neutral-800 text-neutral-100"
        : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
    }`;

  return (
    <div className="flex min-h-screen bg-neutral-950">
      <aside
        className={`fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-neutral-800 bg-neutral-900 transition-transform md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-4">
          <span className="text-xl">⛏️</span>
          <span className="font-bold tracking-tight">MineControl</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {NAV.filter((i) => !i.adminOnly || can("ADMIN")).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={linkClass}
              onClick={() => setMobileOpen(false)}
            >
              <span className="w-5 text-center">{item.icon}</span>
              {t(item.labelKey)}
            </NavLink>
          ))}

          {servers && servers.length > 0 && (
            <div className="pt-4">
              <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-600">
                {t("servers")}
              </p>
              {servers.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/servers/${s.id}`}
                  className={linkClass}
                  onClick={() => setMobileOpen(false)}
                >
                  <StatusDot state={s.status.state} />
                  <span className="truncate">{s.name}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="space-y-2 border-t border-neutral-800 p-3 text-sm">
          <div className="px-1 text-neutral-400">
            🌙 {user?.username} <span className="text-xs text-neutral-600">({user?.role})</span>
          </div>
          <LanguageSwitcher />
          <button
            onClick={() => void logout()}
            className="w-full rounded-md px-3 py-1.5 text-left text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
          >
            {t("logout")}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3 md:hidden">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
            aria-label={t("menu")}
          >
            ☰
          </button>
          <span className="font-semibold">MineControl</span>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>

      {mobileOpen && (
        <button
          className="fixed inset-0 z-10 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label={t("closeMenu")}
        />
      )}
    </div>
  );
}
