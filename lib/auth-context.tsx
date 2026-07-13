'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  created_at?: string;
  origin_cloud?: string;
}

interface AuthContextValue {
  user: UserRecord | null;
  token: string | null;
  loading: boolean;
  setSession: (user: UserRecord, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  setSession: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('token');
    if (!stored || !API_BASE_URL) {
      setLoading(false);
      return;
    }
    fetch(`${API_BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setUser(data);
          setToken(stored);
        } else {
          localStorage.removeItem('token');
        }
      })
      .catch(() => {
        // Network error checking session - leave logged out rather than crash
      })
      .finally(() => setLoading(false));
  }, []);

  function setSession(newUser: UserRecord, newToken: string) {
    localStorage.setItem('token', newToken);
    setUser(newUser);
    setToken(newToken);
  }

  function logout() {
    localStorage.removeItem('token');
    setUser(null);
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
