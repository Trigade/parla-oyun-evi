import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({
  children,
  requirePermission,
  requireAdmin,
}: {
  children: ReactNode;
  requirePermission?: string;
  requireAdmin?: boolean;
}) {
  const { token, isAdmin, hasPermission } = useAuth();

  if (!token) {
    return <Navigate to="/login" replace />;
  }
  const yetkisiz =
    (requireAdmin && !isAdmin) || (requirePermission && !hasPermission(requirePermission));
  if (yetkisiz) {
    return (
      <div className="page">
        <div className="alert alert--error">Bu sayfaya erişim yetkiniz yok.</div>
      </div>
    );
  }
  return <>{children}</>;
}
