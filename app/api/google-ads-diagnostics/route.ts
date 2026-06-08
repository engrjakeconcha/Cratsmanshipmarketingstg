import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthCookieName, isAuthenticated } from "@/lib/auth";
import { getGoogleAdsAccessToken, getGoogleAdsConfig } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(getAuthCookieName())?.value;

  if (!(await isAuthenticated(cookieValue))) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const config = getGoogleAdsConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, message: "Google Ads credentials are not configured." },
      { status: 400 },
    );
  }

  try {
    const accessToken = await getGoogleAdsAccessToken(config);
    const response = await fetch(
      `https://googleads.googleapis.com/${config.apiVersion}/customers:listAccessibleCustomers`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": config.developerToken,
        },
      },
    );
    const body = (await response.json().catch(() => null)) as
      | { resourceNames?: string[]; error?: { message?: string; status?: string } }
      | null;
    const accessibleCustomerIds =
      body?.resourceNames?.map((resourceName) =>
        resourceName.replace("customers/", ""),
      ) ?? [];

    return NextResponse.json(
      {
        ok: response.ok,
        status: response.status,
        configuredCustomerIds: config.customerIds,
        loginCustomerId: config.loginCustomerId,
        accessibleCustomerIds,
        configuredCustomersAccessible: config.customerIds.reduce<
          Record<string, boolean>
        >((result, customerId) => {
          result[customerId] = accessibleCustomerIds.includes(customerId);
          return result;
        }, {}),
        loginCustomerAccessible: config.loginCustomerId
          ? accessibleCustomerIds.includes(config.loginCustomerId)
          : null,
        error: body?.error
          ? {
              status: body.error.status,
              message: body.error.message,
            }
          : undefined,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to run Google Ads diagnostics.",
      },
      { status: 500 },
    );
  }
}
