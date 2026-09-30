import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminRole } from "@/hooks/useAdminRole";
import { useBillingAccess } from "@/hooks/useBillingAccess";
import { useMemberAccess } from "@/hooks/useMemberAccess";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { isAdmin, loading: roleLoading } = useAdminRole();
  const billing = useBillingAccess();
  const access = useMemberAccess();

  const isBillingPage = location.pathname === "/configuracoes/faturamento";

  if (loading || (user && (roleLoading || access.loading || (!isBillingPage && billing.loading)))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!access.isActive) return <Navigate to="/login" replace />;

  if (!isAdmin && !isBillingPage && !billing.allowed) {
    return <Navigate to="/configuracoes/faturamento" replace />;
  }

  return <>{children}</>;
};
