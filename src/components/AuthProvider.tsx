import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { recordSecurityEvent } from "../lib/securityEvents";
import type { User, Session } from "@supabase/supabase-js";
import type { AppRoleKey } from "../lib/roleNavigation";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRoleKey;
  preferences: Record<string, unknown>;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revision = 0;
    let pendingProfile: ReturnType<typeof setTimeout> | undefined;
    let pendingSignInAudit: ReturnType<typeof setTimeout> | undefined;
    let observedUserId: string | undefined;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      const currentRevision = ++revision;
      clearTimeout(pendingProfile);
      setSession(newSession);
      setUser(newSession?.user ?? null);

      const userId = newSession?.user?.id;
      if (userId !== observedUserId) {
        clearTimeout(pendingSignInAudit);
        pendingSignInAudit = undefined;
        observedUserId = userId;
      }
      if (!userId) {
        setProfile(null);
        setLoading(false);
        return;
      }
      setProfile((previous) => (previous?.id === userId ? previous : null));

      // Profile and audit requests can reenter Auth through the Supabase
      // client. Start them after Auth finishes notifying its subscribers.
      // A same-user refresh replaces the profile read but keeps the audit.
      if (event === "SIGNED_IN" && pendingSignInAudit === undefined) {
        pendingSignInAudit = setTimeout(() => {
          pendingSignInAudit = undefined;
          void recordSecurityEvent("sign_in", "Signed in");
        }, 0);
      }
      pendingProfile = setTimeout(() => {
        void (async () => {
          try {
            const { data, error } = await supabase
              .from("user_profiles")
              .select("*")
              .eq("id", userId)
              .maybeSingle();
            if (error) throw error;
            if (currentRevision === revision) setProfile(data);
          } catch (error) {
            if (currentRevision !== revision) return;
            console.error("Auth profile error:", error);
          } finally {
            if (currentRevision === revision) setLoading(false);
          }
        })();
      }, 0);
    });

    return () => {
      revision++;
      clearTimeout(pendingProfile);
      clearTimeout(pendingSignInAudit);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) throw error;
  };

  const signOut = async () => {
    await recordSecurityEvent("sign_out", "Signed out");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, session, loading, signIn, signUp, signOut }}
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

/** Safe on public/demo surfaces that may render outside AuthProvider. */
export function useOptionalAuth() {
  return useContext(AuthContext);
}
