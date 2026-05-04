import { ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getHomeRouteForRole } from "@/lib/roleRoutes";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, userRole, loading, roleLoading, roleError, refreshUserRole, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !roleLoading) {
      if (!user) {
        navigate("/login", { replace: true });
      } else if (userRole && allowedRoles && !allowedRoles.includes(userRole)) {
        navigate(getHomeRouteForRole(userRole), { replace: true });
      }
    }
  }, [user, userRole, loading, roleLoading, allowedRoles, navigate]);

  if (loading || (user && roleLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (user && !userRole) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Account access unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {roleError || "We could not determine your access permissions for this account."}
          </p>
          <div className="mt-6 flex gap-3">
            <Button onClick={() => void refreshUserRole()}>Retry</Button>
            <Button variant="outline" onClick={() => void signOut()}>Return to Login</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!user || !userRole || (allowedRoles && !allowedRoles.includes(userRole))) {
    return null;
  }

  return <>{children}</>;
}
