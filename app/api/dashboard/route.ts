import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadDashboardPayload } from "@/lib/dashboard";
import { getAuthCookieName, isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(getAuthCookieName())?.value;

  if (!(await isAuthenticated(cookieValue))) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const payload = await loadDashboardPayload();

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
