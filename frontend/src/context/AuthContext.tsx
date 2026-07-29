"use client";

import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";
import { api, ApiError } from "@/lib/api";

interface AuthContextValue {
  code: string | null;
  isAuthed: boolean;
  isChecking: boolean;
  error: string | null;
  login: (code: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Deliberately held only in React state, never persisted (no localStorage,
  // sessionStorage, or cookie) — the access code must not survive a refresh.
  const [code, setCode] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (candidateCode: string) => {
    setIsChecking(true);
    setError(null);
    try {
      const res = await api.checkAuth(candidateCode);
      if (res.ok) {
        setCode(candidateCode);
        return true;
      }
      setError("That access code was not accepted.");
      return false;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Unable to verify the access code.";
      setError(message);
      return false;
    } finally {
      setIsChecking(false);
    }
  }, []);

  const logout = useCallback(() => {
    setCode(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ code, isAuthed: code !== null, isChecking, error, login, logout }),
    [code, isChecking, error, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
