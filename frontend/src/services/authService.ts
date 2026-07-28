import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from './supabaseClient';

/**
 * Servicio de autenticación basado en Supabase Auth. No maneja JWT manualmente:
 * Supabase gestiona la sesión y el refresh; aquí sólo exponemos operaciones.
 */
export const authService = {
  async login(email: string, password: string) {
    return getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
  },

  async logout() {
    return getSupabaseBrowserClient().auth.signOut();
  },

  async getSession(): Promise<Session | null> {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    return data.session ?? null;
  },

  async getAccessToken(): Promise<string | null> {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    return data.session?.access_token ?? null;
  },

  async getUser(): Promise<User | null> {
    const { data } = await getSupabaseBrowserClient().auth.getUser();
    return data.user ?? null;
  },

  onAuthStateChange(callback: (session: Session | null) => void) {
    const { data } = getSupabaseBrowserClient().auth.onAuthStateChange((_event, session) => callback(session));
    return data.subscription;
  }
};
