import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext(null);

function normalizeUser(user) {
  if (!user || typeof user !== 'object') return null;

  const name = typeof user.name === 'string' ? user.name.trim() : '';
  const role = typeof user.role === 'string' ? user.role.trim() : '';

  if (!name || !role) return null;

  return {
    ...user,
    name,
    role,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/me')
      .then((res) => setUser(normalizeUser(res.data.user)))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth', { email, password });
    setUser(normalizeUser(res.data.user));
    return res.data;
  };

  const logout = async () => {
    await api.post('/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
