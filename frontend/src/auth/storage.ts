/**
 * Token storage strategy. "Remember me" persists in localStorage (survives
 * browser restart); otherwise sessionStorage (cleared when the tab closes).
 * Pure, side-effect-isolated helpers — unit tested.
 */
const KEY = 'orion.auth.token';

export function saveToken(token: string, remember: boolean): void {
  clearToken();
  (remember ? localStorage : sessionStorage).setItem(KEY, token);
}

export function loadToken(): string | null {
  return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
}

export function clearToken(): void {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
