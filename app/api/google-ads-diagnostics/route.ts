import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthCookieName, isAuthenticated } from "@/lib/auth";
import { getGoogleAdsAccessToken, getGoogleAdsConfig } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

type GoogleAdsProbe = {
  name: string;
  ok: boolean;
  status: number;
  summary: string;
  resultCount?: number;
  customerIds?: string[];
  error?: {
    status?: string;
    message?: string;
  };
};

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
    const probes: GoogleAdsProbe[] = [];

    probes.push(await listAccessibleCustomers(config, accessToken));

    if (config.loginCustomerId) {
      probes.push(
        await runSearchStreamProbe({
          accessToken,
          config,
          customerId: config.loginCustomerId,
          name: "manager_customer_client_hierarchy",
          query: `
            SELECT
              customer_client.client_customer,
              customer_client.descriptive_name,
              customer_client.manager,
              customer_client.status
            FROM customer_client
            WHERE customer_client.level <= 1
          `,
        }),
      );
    }

    for (const customerId of config.customerIds) {
      probes.push(
        await runSearchProbe({
          accessToken,
          config,
          customerId,
          name: `customer_metadata_${customerId}`,
          query: `
            SELECT
              customer.id,
              customer.descriptive_name,
              customer.manager
            FROM customer
            LIMIT 1
          `,
        }),
      );
      probes.push(
        await runSearchProbe({
          accessToken,
          config,
          customerId,
          name: `campaign_spend_search_${customerId}`,
          query: `
            SELECT
              segments.date,
              metrics.cost_micros
            FROM campaign
            WHERE segments.date DURING LAST_30_DAYS
            LIMIT 10
          `,
        }),
      );
    }

    return NextResponse.json(
      {
        ok: probes.some((probe) => probe.ok),
        configuredCustomerIds: config.customerIds,
        loginCustomerId: config.loginCustomerId,
        probes,
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

async function listAccessibleCustomers(
  config: NonNullable<ReturnType<typeof getGoogleAdsConfig>>,
  accessToken: string,
): Promise<GoogleAdsProbe> {
  const response = await fetch(
    `https://googleads.googleapis.com/${config.apiVersion}/customers:listAccessibleCustomers`,
    {
      method: "GET",
      headers: getGoogleAdsHeaders(config, accessToken),
    },
  );
  const body = await parseGoogleAdsResponse(response);
  const customerIds =
    body.json?.resourceNames?.map((resourceName: string) =>
      resourceName.replace("customers/", ""),
    ) ?? [];

  return {
    name: "list_accessible_customers",
    ok: response.ok,
    status: response.status,
    summary: response.ok
      ? `Returned ${customerIds.length} accessible customer(s).`
      : summarizeGoogleAdsDiagnosticError(body),
    customerIds,
    error: body.error,
  };
}

async function runSearchProbe({
  accessToken,
  config,
  customerId,
  name,
  query,
}: {
  accessToken: string;
  config: NonNullable<ReturnType<typeof getGoogleAdsConfig>>;
  customerId: string;
  name: string;
  query: string;
}): Promise<GoogleAdsProbe> {
  const response = await fetch(
    `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: getGoogleAdsHeaders(config, accessToken),
      body: JSON.stringify({ pageSize: 100, query }),
    },
  );
  const body = await parseGoogleAdsResponse(response);
  const resultCount = Array.isArray(body.json?.results)
    ? body.json.results.length
    : undefined;

  return {
    name,
    ok: response.ok,
    status: response.status,
    summary: response.ok
      ? `Returned ${resultCount ?? 0} result(s).`
      : summarizeGoogleAdsDiagnosticError(body),
    resultCount,
    error: body.error,
  };
}

async function runSearchStreamProbe({
  accessToken,
  config,
  customerId,
  name,
  query,
}: {
  accessToken: string;
  config: NonNullable<ReturnType<typeof getGoogleAdsConfig>>;
  customerId: string;
  name: string;
  query: string;
}): Promise<GoogleAdsProbe> {
  const response = await fetch(
    `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: getGoogleAdsHeaders(config, accessToken),
      body: JSON.stringify({ query }),
    },
  );
  const body = await parseGoogleAdsResponse(response);
  const resultCount = Array.isArray(body.json)
    ? body.json.reduce(
        (count: number, chunk: { results?: unknown[] }) =>
          count + (chunk.results?.length ?? 0),
        0,
      )
    : undefined;

  return {
    name,
    ok: response.ok,
    status: response.status,
    summary: response.ok
      ? `Returned ${resultCount ?? 0} result(s).`
      : summarizeGoogleAdsDiagnosticError(body),
    resultCount,
    error: body.error,
  };
}

function getGoogleAdsHeaders(
  config: NonNullable<ReturnType<typeof getGoogleAdsConfig>>,
  accessToken: string,
) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "developer-token": config.developerToken,
    ...(config.loginCustomerId
      ? { "login-customer-id": config.loginCustomerId }
      : {}),
  };
}

async function parseGoogleAdsResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return { json: null, error: undefined, text };
  }

  try {
    const json = JSON.parse(text);
    const error = Array.isArray(json)
      ? json.find((entry) => entry.error)?.error
      : json.error;

    return {
      json,
      error: error
        ? {
            status: error.status,
            message: error.message,
          }
        : undefined,
      text,
    };
  } catch {
    return { json: null, error: undefined, text };
  }
}

function summarizeGoogleAdsDiagnosticError(
  body: Awaited<ReturnType<typeof parseGoogleAdsResponse>>,
) {
  if (body.error?.status || body.error?.message) {
    return [body.error.status, body.error.message].filter(Boolean).join(": ");
  }

  return body.text ? body.text.slice(0, 240) : "No error details returned.";
}
