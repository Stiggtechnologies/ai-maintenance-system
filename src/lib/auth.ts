import { supabase } from './supabase';

export interface SignUpData {
  email: string;
  password: string;
  fullName: string;
  company: string;
  role: string;
  industry: string;
}

export interface AuthError {
  message: string;
  code?: string;
}

export async function signUp(data: SignUpData): Promise<{ success: boolean; error?: AuthError }> {
  try {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.fullName,
        },
      },
    });

    if (authError) {
      return { success: false, error: { message: authError.message, code: authError.status?.toString() } };
    }

    if (!authData.user) {
      return { success: false, error: { message: 'Failed to create user account' } };
    }

    const { error: profileError } = await supabase.from('user_profiles').insert({
      id: authData.user.id,
      full_name: data.fullName,
      company: data.company,
      role: data.role,
      industry: data.industry,
      trial_sessions_remaining: 10,
      trial_sessions_used: 0,
      subscription_tier: 'explorer',
    });

    if (profileError) {
      return { success: false, error: { message: 'Failed to create user profile' } };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: { message: 'An unexpected error occurred' } };
  }
}

export async function signIn(email: string, password: string): Promise<{ success: boolean; error?: AuthError }> {
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return { success: false, error: { message: "We couldn't verify your credentials. Please confirm or contact your administrator.", code: error.status?.toString() } };
      }
      return { success: false, error: { message: error.message, code: error.status?.toString() } };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: { message: 'An unexpected error occurred' } };
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getUserProfile() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !profile) return null;

  return profile;
}
