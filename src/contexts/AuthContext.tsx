import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { isPushSupported, unsubscribeFromPush } from "@/utils/pushSubscription";
import { getAppUrl } from "@/lib/appConfig";
import { setUserContext, clearUserContext, captureError } from "@/lib/sentryHelpers";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userRole: string | null;
  loading: boolean;
  roleLoading: boolean;
  roleError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, userData: any) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  refreshUserRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const lastUserIdRef = useRef<string | null>(null);
  const roleRequestIdRef = useRef(0);

  const resolveUserRole = useCallback(async (userId: string) => {
    const { data, error } = await supabase.rpc("get_user_role", { _user_id: userId });

    if (error) {
      throw error;
    }

    return data ?? null;
  }, []);

  const loadUserRole = useCallback(async (userId: string) => {
    const requestId = ++roleRequestIdRef.current;
    setRoleLoading(true);
    setRoleError(null);

    try {
      const role = await resolveUserRole(userId);

      if (!isMountedRef.current || requestId !== roleRequestIdRef.current) {
        return null;
      }

      if (!role) {
        setUserRole(null);
        setRoleError("Your account is not approved yet or does not have an assigned role.");
        return null;
      }

      setUserRole(role);
      setUserContext({ id: userId, role });
      return role;
    } catch (error) {
      if (!isMountedRef.current || requestId !== roleRequestIdRef.current) {
        return null;
      }

      captureError(error, { tags: { flow: 'role_resolution' }, extras: { userId } });
      if (import.meta.env.DEV) console.error("Error fetching user role:", error);
      setUserRole(null);
      setRoleError("Unable to load your account permissions. Please try again.");
      return null;
    } finally {
      if (isMountedRef.current && requestId === roleRequestIdRef.current) {
        setRoleLoading(false);
      }
    }
  }, [resolveUserRole]);

  const syncSession = useCallback(async (nextSession: Session | null) => {
    // Always update session & user so token refreshes are reflected immediately
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    const nextUserId = nextSession?.user?.id ?? null;

    // Only reload role when the user identity actually changes
    if (lastUserIdRef.current === nextUserId) {
      setLoading(false);
      return;
    }

    lastUserIdRef.current = nextUserId;

    if (!nextUserId) {
      roleRequestIdRef.current += 1;
      setUserRole(null);
      setRoleError(null);
      setRoleLoading(false);
      setLoading(false);
      return;
    }

    await loadUserRole(nextUserId);
    if (isMountedRef.current) {
      setLoading(false);
    }
  }, [loadUserRole]);

  useEffect(() => {
    isMountedRef.current = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSession(nextSession);
    });

    const initializeApp = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          if (import.meta.env.DEV) console.error("Error restoring session:", error);
          setRoleError("Unable to restore your session. Please sign in again.");
          await syncSession(null);
          return;
        }

        await syncSession(data.session);
      } catch (error) {
        if (import.meta.env.DEV) console.error("Unexpected auth initialization error:", error);
        setRoleError("Unable to initialize authentication. Please refresh and try again.");
        setLoading(false);
      }
    };

    void initializeApp();

    return () => {
      isMountedRef.current = false;
      roleRequestIdRef.current += 1;
      subscription.unsubscribe();
    };
  }, [syncSession]);

  const refreshUserRole = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    await loadUserRole(user.id);
  }, [loadUserRole, user?.id]);

  const signIn = async (email: string, password: string) => {
    try {
      setRoleError(null);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) return { error };

      if (!data.user) {
        return { error: new Error("Login did not return a user session.") };
      }

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signUp = async (email: string, password: string, userData: any) => {
    try {
      const redirectUrl = getAppUrl("/");
      const normalizedLicenses = Array.isArray(userData.licenses)
        ? userData.licenses.map((license: string) => license.toLowerCase())
        : [];

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            ...userData,
            licenses: normalizedLicenses,
            registration_source: "self-service",
          },
        },
      });

      if (error) return { error };

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signOut = async () => {
    // Unregister push subscription before signing out
    if (isPushSupported()) await unsubscribeFromPush().catch(() => {});
    clearUserContext();
    // Clear local auth state immediately so downstream components react
    // before the async server call completes.
    lastUserIdRef.current = null;
    setUser(null);
    setSession(null);
    setUserRole(null);
    setRoleError(null);
    setRoleLoading(false);
    roleRequestIdRef.current += 1;
    await supabase.auth.signOut();
    navigate('/login');
  };

  const resetPassword = async (email: string) => {
    try {
      const redirectUrl = getAppUrl("/reset-password");

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      return { error };
    } catch (error: any) {
      return { error };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        userRole,
        loading,
        roleLoading,
        roleError,
        signIn,
        signUp,
        signOut,
        resetPassword,
        refreshUserRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
