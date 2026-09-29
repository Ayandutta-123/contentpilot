'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api } from '@/lib/api';

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
  companyName: string;
  isActive: boolean;
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  companyName?: string;
  companies?: CompanySummary[];
  needsCompanyChoice?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  companies: CompanySummary[];
  login: (email: string, password: string, tenantSlug?: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  switchCompany: (tenantId: string) => Promise<User>;
  createCompany: (name: string, slug?: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const applyUser = useCallback((next: User | null) => {
    setUser(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ success: boolean; data: User }>('/auth/me');
      applyUser(res.data);
    } catch {
      applyUser(null);
    }
  }, [applyUser]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ success: boolean; data: User }>('/auth/me');
        if (!cancelled) applyUser(res.data);
      } catch {
        if (!cancelled) applyUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  const login = async (email: string, password: string, tenantSlug?: string) => {
    const body: Record<string, string> = { email, password };
    if (tenantSlug?.trim()) body.tenantSlug = tenantSlug.trim();
    const res = await api<{ success: boolean; data: User }>('/auth/login', {
      method: 'POST',
      body,
    });
    const next = res.data;
    applyUser(next);
    return next;
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // still clear local state
    }
    applyUser(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  const switchCompany = async (tenantId: string) => {
    const res = await api<{ success: boolean; data: User }>('/auth/switch-company', {
      method: 'POST',
      body: { tenantId },
    });
    applyUser(res.data);
    return res.data;
  };

  const createCompany = async (name: string, slug?: string) => {
    const res = await api<{ success: boolean; data: User }>('/auth/companies', {
      method: 'POST',
      body: { name, slug: slug || undefined },
    });
    applyUser(res.data);
    return res.data;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        companies: user?.companies || [],
        login,
        logout,
        refresh,
        switchCompany,
        createCompany,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
