"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { getUserProfile, type UserProfile } from "@/lib/api";

const STORAGE_KEY = "pullvault.auth";

type StoredAuth = {
  token: string;
  user: UserProfile;
};

type AuthContextValue = {
  user: UserProfile | null;
  token: string | null;
  isReady: boolean;
  setAuth: (payload: StoredAuth) => void;
  clearAuth: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed?.token || !parsed?.user?.id) {
      return null;
    }

    return {
      token: parsed.token,
      user: {
        ...parsed.user,
        auctionBalance: parsed.user.auctionBalance ?? "0.00"
      }
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const stored = readStoredAuth();
    if (stored) {
      setUser(stored.user);
      setToken(stored.token);
    }

    setIsReady(true);
  }, []);

  const setAuth = useCallback((payload: StoredAuth) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setUser(payload.user);
    setToken(payload.token);
  }, []);

  const clearAuth = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setToken(null);
  }, []);

  useEffect(() => {
    if (!token || !user?.id) {
      return;
    }
    let cancelled = false;
    void getUserProfile(user.id)
      .then((freshUser) => {
        if (cancelled) return;
        setAuth({
          token,
          user: {
            ...freshUser,
            auctionBalance: freshUser.auctionBalance ?? "0.00"
          }
        });
      })
      .catch(() => {
        // Keep local auth state if refresh fails (network blip, API restart, etc).
      });
    return () => {
      cancelled = true;
    };
  }, [token, user?.id, setAuth]);

  const value = useMemo(
    () => ({ user, token, isReady, setAuth, clearAuth }),
    [user, token, isReady, setAuth, clearAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return ctx;
}
