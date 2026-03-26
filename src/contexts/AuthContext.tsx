import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getHomeRouteForRole } from "@/lib/roleRoutes";
import { useNavigate } from "react-router-dom";
import { isPushSupported, unsubscribeFromPush } from "@/utils/pushSubscription";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userRole: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, userData: any) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let initialLoad = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (initialLoad) return; // Skip during init to avoid duplicate fetchUserRole

        if (session?.user) {
          setTimeout(() => fetchUserRole(session.user.id), 0);
        } else {
          setUserRole(null);
        }
      }
    );

    const initializeApp = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        await fetchUserRole(session.user.id);
      }
      setLoading(false);
      initialLoad = false;
    };

    initializeApp();

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .rpc('get_user_role', { _user_id: userId });

      if (error) throw error;
      setUserRole(data);
      return data;
    } catch (error) {
      if (import.meta.env.DEV) console.error("Error fetching user role:", error);
      setUserRole(null);
      return null;
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) return { error };

      // Fetch user role after successful login
      if (data.user) {
        const role = await fetchUserRole(data.user.id);
        navigate(getHomeRouteForRole(role));
      }

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signUp = async (email: string, password: string, userData: any) => {
    try {
      const redirectUrl = `${window.location.origin}/`;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: userData,
        },
      });

      if (error) return { error };

      // Profile is auto-created by the handle_new_user DB trigger.
      // Update it with the additional fields provided during registration.
      if (data.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            full_name: userData.full_name,
            employee_id: userData.employee_id,
            mobile: userData.mobile,
            designation: userData.designation,
            current_shift: userData.current_shift,
          })
          .eq('id', data.user.id);

        if (profileError) return { error: profileError };

        // Create user role entry — NOT auto-approved; requires admin review
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({
            user_id: data.user.id,
            role: 'employee',
            approved: false,
          });

        if (roleError) return { error: roleError };

        // Create license entries if provided
        if (userData.licenses && userData.licenses.length > 0) {
          const licenseEntries = userData.licenses.map((license: string) => ({
            user_id: data.user.id,
            license_type: license,
          }));

          const { error: licenseError } = await supabase
            .from('employee_licenses')
            .insert(licenseEntries);

          if (licenseError) return { error: licenseError };
        }
      }

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signOut = async () => {
    // Unregister push subscription before signing out
    if (isPushSupported()) await unsubscribeFromPush().catch(() => {});
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setUserRole(null);
    navigate('/login');
  };

  const resetPassword = async (email: string) => {
    try {
      const redirectUrl = `${window.location.origin}/reset-password`;

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
        signIn,
        signUp,
        signOut,
        resetPassword,
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
