/**
 * Authentication and Session Storage Utilities for DeepVerify
 */

export interface AuthUser {
  user_id: string;
  email: string;
  role: 'candidate' | 'recruiter';
  full_name: string;
  phone?: string | null;
  college?: string | null;
  degree?: string | null;
  graduation_year?: string | null;
  company_name?: string | null;
  designation?: string | null;
  profile_photo_url?: string | null;
  created_at: string;
}

const TOKEN_KEY = 'dv_auth_token';
const USER_KEY = 'dv_auth_user';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAuthUser(): AuthUser | null {
  const data = localStorage.getItem(USER_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data) as AuthUser;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAuthToken();
}

export function isCandidate(): boolean {
  const user = getAuthUser();
  return user?.role === 'candidate';
}

export function isRecruiter(): boolean {
  const user = getAuthUser();
  return user?.role === 'recruiter';
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }
  return {};
}
