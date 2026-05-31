const AUTH_COOKIE_NAME = "cm_dashboard_auth";

export function getAuthCookieName() {
  return AUTH_COOKIE_NAME;
}

export async function verifyPassword(password: string) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return false;
  }

  return password === expected;
}

export async function createAuthCookieValue() {
  return process.env.DASHBOARD_SESSION_TOKEN ?? "cm-dashboard-session";
}

export async function isAuthenticated(cookieValue?: string) {
  if (!cookieValue) {
    return false;
  }

  return cookieValue === (await createAuthCookieValue());
}
