import type { Role } from "@minecontrol/shared";
import { hasRole } from "@minecontrol/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { AppShell } from "./components/AppShell.js";
import { AddServerPage } from "./pages/AddServerPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PlayerProfilePage } from "./pages/PlayerProfilePage.js";
import { PlayersPage } from "./pages/PlayersPage.js";
import { ServerDetailPage } from "./pages/ServerDetailPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { UsersPage } from "./pages/UsersPage.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});

/**
 * Leitet unangemeldete Nutzer auf /login und wartet auf den Auth-Check.
 * Mit `role` wird zusätzlich eine Mindestrolle verlangt.
 */
function RequireAuth({ children, role }: { children: ReactNode; role?: Role }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-500">
        Lade…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (role && !hasRole(user.role, role)) {
    return (
      <AppShell>
        <p className="text-status-error">Keine Berechtigung für diese Seite.</p>
      </AppShell>
    );
  }
  return <AppShell>{children}</AppShell>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/servers/new"
        element={
          <RequireAuth>
            <AddServerPage />
          </RequireAuth>
        }
      />
      <Route
        path="/servers/:id"
        element={
          <RequireAuth>
            <ServerDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/players"
        element={
          <RequireAuth>
            <PlayersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/players/:key"
        element={
          <RequireAuth>
            <PlayerProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAuth role="ADMIN">
            <UsersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireAuth role="ADMIN">
            <AuditPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
