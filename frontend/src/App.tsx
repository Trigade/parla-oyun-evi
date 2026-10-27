import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import KasaEkrani from "./pages/KasaEkrani";
import Dashboard from "./pages/Dashboard";
import GunSonu from "./pages/GunSonu";
import Musteriler from "./pages/Musteriler";
import SatinAlma from "./pages/SatinAlma";
import Kullanicilar from "./pages/Kullanicilar";
import FiyatPolitikasi from "./pages/FiyatPolitikasi";
import Login from "./pages/Login";
import TemaButonu from "./components/TemaButonu";
import { SURUM } from "./surum";

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link to={to} className={`navlink${active ? " active" : ""}`}>
      {children}
    </Link>
  );
}

function Nav() {
  const { token, isAdmin, hasPermission, logout } = useAuth();
  if (!token) return null;
  return (
    <nav className="topnav">
      <Link to="/" className="topnav__brand">
        <span className="logo-disc topnav__logo">
          <img src="/parla-tabela.jpg" alt="Parla Oyun Evi" />
        </span>
        <span className="topnav__title">
          Parla Oyun Evi
          <small>
            Süre Takip &amp; Adisyon <span className="surum-pill">{SURUM}</span>
          </small>
        </span>
      </Link>
      <NavLink to="/">Kasa Ekranı</NavLink>
      {hasPermission("dashboard") && <NavLink to="/dashboard">Yönetici Dashboard</NavLink>}
      {hasPermission("gun_sonu") && <NavLink to="/gun-sonu">Gün Sonu</NavLink>}
      {hasPermission("musteriler") && <NavLink to="/musteriler">Müşteriler</NavLink>}
      {hasPermission("musteriler") && <NavLink to="/satin-alma">Satın Alma</NavLink>}
      {isAdmin && <NavLink to="/kullanicilar">Kullanıcı Yönetimi</NavLink>}
      {isAdmin && <NavLink to="/fiyat-politikasi">Fiyat Politikası</NavLink>}
      <button className="ghost" onClick={logout}>Çıkış Yap</button>
      <TemaButonu />
    </nav>
  );
}

function LoginRoute() {
  const { token } = useAuth();
  if (token) return <Navigate to="/" replace />;
  return <Login />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Nav />
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <KasaEkrani />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requirePermission="dashboard">
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/gun-sonu"
            element={
              <ProtectedRoute requirePermission="gun_sonu">
                <GunSonu />
              </ProtectedRoute>
            }
          />
          <Route
            path="/musteriler"
            element={
              <ProtectedRoute requirePermission="musteriler">
                <Musteriler />
              </ProtectedRoute>
            }
          />
          <Route
            path="/satin-alma"
            element={
              <ProtectedRoute requirePermission="musteriler">
                <SatinAlma />
              </ProtectedRoute>
            }
          />
          <Route
            path="/kullanicilar"
            element={
              <ProtectedRoute requireAdmin>
                <Kullanicilar />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fiyat-politikasi"
            element={
              <ProtectedRoute requireAdmin>
                <FiyatPolitikasi />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
