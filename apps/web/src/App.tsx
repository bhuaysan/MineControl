import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { AppShell } from "./components/AppShell.js";
import { AddServerPage } from "./pages/AddServerPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PlaceholderPage } from "./pages/PlaceholderPage.js";
import { ServerDetailPage } from "./pages/ServerDetailPage.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});

/** Leitet unangemeldete Nutzer auf /login, wartet auf den Auth-Check. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-500">
        Lade…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
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
            <PlaceholderPage title="Spieler" />
          </RequireAuth>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAuth>
            <PlaceholderPage title="Benutzerverwaltung" />
          </RequireAuth>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireAuth>
            <AuditPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <PlaceholderPage title="Einstellungen" />
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
