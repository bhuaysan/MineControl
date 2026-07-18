import type { MeResponse, Role } from "@minecontrol/shared";
import { hasRole } from "@minecontrol/shared";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiRequestError, api } from "../lib/api.js";

interface AuthState {
  user: MeResponse | null;
  loading: boolean;
  login: (username: string, password: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (required: Role) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((err) => {
        if (!(err instanceof ApiRequestError && err.status === 401)) {
          console.error("Auth-Check fehlgeschlagen:", err);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string, code?: string) => {
    setUser(await api.login({ username, password, code }));
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  const refresh = async () => {
    setUser(await api.me());
  };

  const can = (required: Role) => (user ? hasRole(user.role, required) : false);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth muss innerhalb von AuthProvider verwendet werden");
  return ctx;
}
