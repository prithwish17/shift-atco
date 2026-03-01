import { ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, userRole, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate("/login");
      } else if (userRole && allowedRoles && !allowedRoles.includes(userRole)) {
        // Role loaded but not authorized — redirect to employee dashboard
        navigate('/employee');
      }
      // If user exists but userRole is still null, wait — don't redirect yet
    }
  }, [user, userRole, loading, allowedRoles, navigate]);

  // Show spinner while auth state or role is loading
  if (loading || (user && !userRole)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Block rendering if not authenticated or not authorized
  if (!user || !userRole || (allowedRoles && !allowedRoles.includes(userRole))) {
    return null;
  }

  return <>{children}</>;
}
