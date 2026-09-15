import { createContext, useContext, useState, type ReactNode } from "react";
import {
  api,
  clearSession,
  getIsAdmin,
  getPermissions,
  getToken,
  getUserId,
  setSession,
  type LoginResponse,
  type LoginStepResponse,
} from "../api/client";

interface AuthState {
  token: string | null;
  isAdmin: boolean;
  permissions: string[];
  userId: number | null;
  hasPermission: (perm: string) => boolean;
  // login yalnızca kullanıcı adı/şifreyi doğrular; TOTP her hesapta zorunlu
  // olduğundan tam oturumu hemen açmaz. Dönen sonuca göre (setup_token ya da
  // pending_token) çağıran taraf (Login.tsx) QR kurulum veya kod doğrulama
  // ekranını gösterir; oturum ancak finishLogin çağrılınca gerçekten açılır.
  login: (username: string, password: string) => Promise<LoginStepResponse>;
  finishLogin: (res: LoginResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(getToken());
  const [isAdmin, setIsAdmin] = useState(getIsAdmin());
  const [permissions, setPermissions] = useState<string[]>(getPermissions());
  const [userId, setUserId] = useState(getUserId());

  async function login(username: string, password: string) {
    return api.login(username, password);
  }

  function finishLogin(res: LoginResponse) {
    setSession(res.token, res.is_admin, res.permissions, res.user_id);
    setToken(res.token);
    setIsAdmin(res.is_admin);
    setPermissions(res.permissions);
    setUserId(res.user_id);
  }

  function logout() {
    clearSession();
    setToken(null);
    setIsAdmin(false);
    setPermissions([]);
    setUserId(null);
  }

  function hasPermission(perm: string) {
    return isAdmin || permissions.includes(perm);
  }

  return (
    <AuthContext.Provider
      value={{ token, isAdmin, permissions, userId, hasPermission, login, finishLogin, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth, AuthProvider içinde kullanılmalıdır");
  return ctx;
}
