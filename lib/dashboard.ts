import { google } from "googleapis";
import { getSampleDashboardRows } from "@/lib/sample-data";

const DEFAULT_GOOGLE_SHEETS_SPREADSHEET_ID =
  "1NcKP_DrtxK9XArJhcZVvhKVBh2tw5vu5PBnrBHePlg4";
const DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL =
  "craftsmanship-marketing@craftsmanship-marketing-stg.iam.gserviceaccount.com";
const MISSING_LOCATION_LABEL = "Location Not Set";

export type DashboardRow = {
  date: string;
  location: string;
  service: string;
  leads: number;
  booked: number;
  canceled: number;
  spend: number;
};

export type DashboardMetricKey =
  | "leads"
  | "booked"
  | "spend"
  | "cpl"
  | "costPerAppt"
  | "leadToBooking";

export type MetricSnapshot = Record<DashboardMetricKey, number>;

export type DashboardPayload = {
  rows: DashboardRow[];
  meta: {
    fetchedAt: string;
    locations: string[];
    source: "google-sheets" | "sample-fallback";
    warning?: string;
  };
};

const HEADER_ALIASES = {
  date: ["date", "report date", "day", "creation date", "created date"],
  location: ["company", "location", "market", "city", "region"],
  service: ["service", "services", "category", "campaign", "offering", "service type"],
  leads: ["leads", "lead", "lead count"],
  leadNumber: ["number", "phone", "phone number", "telephone"],
  booked: ["booked", "appointments booked", "booked appts", "appt booked", "appts"],
  canceled: ["canceled", "cancelled", "cancel", "appointments canceled", "appointments cancelled"],
  spend: ["spend", "ad spend", "amount spent", "total spend", "cost"],
  conversionType: ["conversion type", "conversion", "lead type"],
} as const;

export async function loadDashboardPayload(): Promise<DashboardPayload> {
  try {
    const rows = await loadGoogleSheetRows();
    const { rows: rowsWithSpend, warning } = await applyGoogleAdsSpend(rows);

    if (rowsWithSpend.length === 0) {
      return createSamplePayload(
        "Connected to Google Sheets, but no usable rows were found. Showing sample fallback data.",
      );
    }

    return {
      rows: rowsWithSpend,
      meta: {
        fetchedAt: new Date().toISOString(),
        locations: Array.from(new Set(rowsWithSpend.map((row) => row.location))).sort(),
        source: "google-sheets",
        warning,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reach Google Sheets.";
    return createSamplePayload(`${message} Showing sample fallback data.`);
  }
}

async function loadGoogleSheetRows() {
  const spreadsheetId =
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ??
    DEFAULT_GOOGLE_SHEETS_SPREADSHEET_ID;
  const auth = getGoogleAuth();
  const range = process.env.GOOGLE_SHEETS_RANGE ?? "Sheet1!A:Z";

  if (!spreadsheetId || !auth) {
    throw new Error("Google Sheets credentials are not configured.");
  }

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const values = response.data.values ?? [];
  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map((value) => normalizeHeader(value));
  const indices = {
    date: findHeaderIndex(headers, HEADER_ALIASES.date),
    location: findHeaderIndex(headers, HEADER_ALIASES.location),
    service: findHeaderIndex(headers, HEADER_ALIASES.service),
    leads: findHeaderIndex(headers, HEADER_ALIASES.leads),
    leadNumber: findHeaderIndex(headers, HEADER_ALIASES.leadNumber),
    booked: findHeaderIndex(headers, HEADER_ALIASES.booked),
    canceled: findHeaderIndex(headers, HEADER_ALIASES.canceled),
    spend: findHeaderIndex(headers, HEADER_ALIASES.spend),
    conversionType: findHeaderIndex(headers, HEADER_ALIASES.conversionType),
  };

  if (indices.date === -1 || indices.service === -1) {
    throw new Error(
      "The sheet needs Creation Date and Service Type columns for dashboard mapping.",
    );
  }

  return values
    .slice(1)
    .map((row) => mapRow(row, indices))
    .filter((row): row is DashboardRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function mapRow(
  row: string[],
  indices: Record<keyof typeof HEADER_ALIASES, number>,
): DashboardRow | null {
  const rawDate = row[indices.date]?.trim();
  const rawService = row[indices.service]?.trim();
  const rawLeadNumber =
    indices.leadNumber === -1 ? null : row[indices.leadNumber]?.trim();

  if (!rawDate || !rawService || rawLeadNumber === "") {
    return null;
  }

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    date: date.toISOString().slice(0, 10),
    location: readCell(row, indices.location, MISSING_LOCATION_LABEL),
    service: normalizeServiceType(rawService),
    leads: rawLeadNumber ? 1 : readNumber(row, indices.leads, 1),
    booked: readNumber(
      row,
      indices.booked,
      isBookedConversion(row[indices.conversionType]) ? 1 : 0,
    ),
    canceled: readNumber(row, indices.canceled, 0),
    spend: readNumber(row, indices.spend, 0),
  };
}

function createSamplePayload(warning: string): DashboardPayload {
  const rows = getSampleDashboardRows();
  return {
    rows,
    meta: {
      fetchedAt: new Date().toISOString(),
      locations: Array.from(new Set(rows.map((row) => row.location))).sort(),
      source: "sample-fallback",
      warning,
    },
  };
}

async function applyGoogleAdsSpend(rows: DashboardRow[]) {
  try {
    const dailySpend = await loadGoogleAdsDailySpend(rows);
    if (!dailySpend) {
      return { rows };
    }

    const leadsByDate = rows.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row.date] = (accumulator[row.date] ?? 0) + row.leads;
      return accumulator;
    }, {});

    return {
      rows: rows.map((row) => {
        const dateSpend = dailySpend.get(row.date);
        const dateLeads = leadsByDate[row.date] ?? 0;

        if (!dateSpend || dateLeads === 0) {
          return { ...row, spend: 0 };
        }

        return {
          ...row,
          spend: (dateSpend * row.leads) / dateLeads,
        };
      }),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load Google Ads spend.";

    return {
      rows,
      warning: `${message} Showing sheet spend values.`,
    };
  }
}

async function loadGoogleAdsDailySpend(rows: DashboardRow[]) {
  const config = getGoogleAdsConfig();
  if (!config || rows.length === 0) {
    return null;
  }

  const dates = rows.map((row) => row.date).sort();
  const dateFrom = dates[0];
  const dateTo = dates.at(-1);

  if (!dateFrom || !dateTo) {
    return null;
  }

  const accessToken = await getGoogleAdsAccessToken(config);
  const spendByDate = new Map<string, number>();

  for (const customerId of config.customerIds) {
    const response = await fetch(
      `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "developer-token": config.developerToken,
          ...(config.loginCustomerId
            ? { "login-customer-id": config.loginCustomerId }
            : {}),
        },
        body: JSON.stringify({
          query: `
            SELECT
              segments.date,
              metrics.cost_micros
            FROM campaign
            WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
          `,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Google Ads spend request failed with ${response.status}: ${summarizeGoogleAdsError(errorText)}`,
      );
    }

    const chunks = (await response.json()) as Array<{
      results?: Array<{
        segments?: { date?: string };
        metrics?: { costMicros?: string };
      }>;
    }>;

    chunks.forEach((chunk) => {
      chunk.results?.forEach((result) => {
        const date = result.segments?.date;
        const costMicros = Number(result.metrics?.costMicros ?? 0);

        if (!date || !Number.isFinite(costMicros)) {
          return;
        }

        spendByDate.set(date, (spendByDate.get(date) ?? 0) + costMicros / 1_000_000);
      });
    });
  }

  return spendByDate;
}

function getGoogleAdsConfig() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerIds = (process.env.GOOGLE_ADS_CUSTOMER_IDS ?? process.env.GOOGLE_ADS_CUSTOMER_ID)
    ?.split(",")
    .map((customerId) => customerId.replace(/\D/g, ""))
    .filter(Boolean);
  const clientId =
    process.env.GOOGLE_ADS_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_ADS_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken =
    process.env.GOOGLE_ADS_REFRESH_TOKEN ?? process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (
    !developerToken ||
    !customerIds ||
    customerIds.length === 0 ||
    !clientId ||
    !clientSecret ||
    !refreshToken
  ) {
    return null;
  }

  return {
    apiVersion: process.env.GOOGLE_ADS_API_VERSION ?? "v22",
    clientId,
    clientSecret,
    customerIds,
    developerToken,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, ""),
    refreshToken,
  };
}

function summarizeGoogleAdsError(errorText: string) {
  if (!errorText) {
    return "No error details returned.";
  }

  try {
    const parsed = JSON.parse(errorText) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        details?: Array<{
          errors?: Array<{
            message?: string;
            errorCode?: Record<string, string>;
          }>;
        }>;
      };
    };
    const googleAdsError = parsed.error?.details
      ?.flatMap((detail) => detail.errors ?? [])
      .find(Boolean);
    const errorCode = googleAdsError?.errorCode
      ? Object.values(googleAdsError.errorCode).join(", ")
      : parsed.error?.status;
    const message = googleAdsError?.message ?? parsed.error?.message;

    return [errorCode, message].filter(Boolean).join(": ") || "Unknown Google Ads API error.";
  } catch {
    return errorText.slice(0, 240);
  }
}

async function getGoogleAdsAccessToken(config: NonNullable<ReturnType<typeof getGoogleAdsConfig>>) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: config.refreshToken,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google Ads OAuth token request failed with ${response.status}.`);
  }

  const token = (await response.json()) as { access_token?: string };
  if (!token.access_token) {
    throw new Error("Google Ads OAuth token response did not include an access token.");
  }

  return token.access_token;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function findHeaderIndex(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

function toNumber(value?: string) {
  if (!value) {
    return 0;
  }

  const cleaned = value.replace(/[$,%\s,]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readCell(row: string[], index: number, fallback: string) {
  if (index === -1) {
    return fallback;
  }

  const value = row[index]?.trim();
  return value ? toTitleCase(value) : fallback;
}

function readNumber(row: string[], index: number, fallback: number) {
  if (index === -1) {
    return fallback;
  }

  return toNumber(row[index]);
}

function isBookedConversion(value?: string) {
  if (!value) {
    return false;
  }

  return /appointment|calendar|booking|booked|estimate/i.test(value);
}

function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function normalizeServiceType(value: string) {
  const [firstWord] = value.trim().split(/\s+/);
  return firstWord ? toTitleCase(firstWord) : "Uncategorized";
}

function getGoogleAuth() {
  const oauthClient = getGoogleOAuthClient();
  if (oauthClient) {
    return oauthClient;
  }

  const credentials = getGoogleCredentials();
  if (!credentials) {
    return null;
  }

  return new google.auth.JWT({
    email: credentials.clientEmail,
    key: credentials.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });

  return client;
}

function getGoogleCredentials() {
  const encodedJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

  if (encodedJson) {
    try {
      const parsed = JSON.parse(
        Buffer.from(encodedJson, "base64").toString("utf8"),
      ) as { client_email?: string; private_key?: string };

      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
    } catch {
      // Fall through to split credentials if the JSON env is malformed.
    }
  }

  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ??
    DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = getPrivateKey();

  if (!clientEmail || !privateKey) {
    return null;
  }

  return { clientEmail, privateKey };
}

function getPrivateKey() {
  const encodedPrivateKey =
    getChunkedEnv("CM_PRIVATE_KEY_URL") ??
    getChunkedEnv("CM_PRIVATE_KEY_B64") ??
    getChunkedEnv("GOOGLE_PRIVATE_KEY_B64") ??
    getChunkedEnv("GOOGLE_KEY");

  if (encodedPrivateKey) {
    const decoded = Buffer.from(toBase64(encodedPrivateKey), "base64").toString(
      "utf8",
    );
    if (decoded.includes("-----BEGIN PRIVATE KEY-----")) {
      return decoded;
    }
  }

  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (rawPrivateKey?.includes("-----BEGIN PRIVATE KEY-----")) {
    return rawPrivateKey;
  }

  return null;
}

function toBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
}

function getChunkedEnv(name: string) {
  const directValue = process.env[name];

  if (directValue) {
    return directValue;
  }

  const chunks: string[] = [];
  for (let index = 1; index <= 50; index += 1) {
    const value = process.env[`${name}_${index}`];
    if (!value) {
      break;
    }
    chunks.push(value);
  }

  return chunks.length > 0 ? chunks.join("") : null;
}
