import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "supervisor" | "field";

export type SessionInfo = {
  userId: string;
  username: string;
  fullName: string | null;
  role: AppRole;
};

export const USER_EMAIL_DOMAIN = "proconect.local";

export function usernameToEmail(username: string) {
  return `${username.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;
}

export async function signIn(username: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) throw new Error("Utilizator sau parolă incorectă.");
}

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("username, full_name").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);

  return {
    userId: user.id,
    username: profile?.username ?? user.email?.split("@")[0] ?? "utilizator",
    fullName: profile?.full_name ?? null,
    role: ((roles?.[0]?.role as AppRole | undefined) ?? "field") satisfies AppRole,
  };
}

export async function signOut() {
  await supabase.auth.signOut();
}
