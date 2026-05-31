import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardApp } from "@/components/dashboard-app";
import { loadDashboardPayload } from "@/lib/dashboard";
import { getAuthCookieName, isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(getAuthCookieName())?.value;

  if (!(await isAuthenticated(cookieValue))) {
    redirect("/login");
  }

  const payload = await loadDashboardPayload();

  return <DashboardApp initialPayload={payload} />;
}
