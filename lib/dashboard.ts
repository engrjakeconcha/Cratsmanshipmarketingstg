import { google } from "googleapis";
import { getSampleDashboardRows } from "@/lib/sample-data";

const DEFAULT_GOOGLE_SHEETS_SPREADSHEET_ID =
  "1NcKP_DrtxK9XArJhcZVvhKVBh2tw5vu5PBnrBHePlg4";
const DEFAULT_BOOKED_APPOINTMENTS_SPREADSHEET_ID =
  "1amSD2ll-WBWaq7TUK-Bzdms2vUVZ3nlfxjoMOH0xuZM";
const DEFAULT_GOOGLE_SHEETS_RANGE = "Sheet1!A:Z";
const DEFAULT_BOOKED_APPOINTMENTS_RANGE = "appointments CM!A:Z";
const DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL =
  "craftsmanship-marketing@craftsmanship-marketing-stg.iam.gserviceaccount.com";
const MISSING_LOCATION_LABEL = "Location Not Set";
const ALLOWED_SERVICES = ["Bathroom", "Kitchen", "Home"] as const;
const ADS_SPEND_REPORT_TITLE = "Ads Spent Report";
const ADS_SPEND_LOCATIONS = ["San Diego", "Texas"] as const;

export type DashboardRow = {
  date: string;
  location: string;
  service: string;
  leads: number;
  booked: number;
  canceled: number;
  spend: number;
};

type SpendMap = Map<string, number>;
type AdsSpendRow = {
  date: string;
  location: string;
  service: string;
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
  status: ["status", "appointment status", "appt status"],
} as const;

const BOOKED_APPOINTMENT_HEADER_ALIASES = {
  date: [
    "date",
    "appointment date",
    "appt date",
    "scheduled date",
    "start date",
    "start time",
    "appointment start",
  ],
  location: HEADER_ALIASES.location,
  service: HEADER_ALIASES.service,
  status: HEADER_ALIASES.status,
} as const;

export async function loadDashboardPayload(): Promise<DashboardPayload> {
  try {
    const rows = await loadGoogleSheetRows();
    const bookedResult = await applyBookedAppointments(rows);
    const spendResult = await applyGoogleAdsSpend(bookedResult.rows);
    const warning = combineWarnings(bookedResult.warning, spendResult.warning);
    const rowsWithSpend = spendResult.rows;

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
  const range = process.env.GOOGLE_SHEETS_RANGE ?? DEFAULT_GOOGLE_SHEETS_RANGE;

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
    status: findHeaderIndex(headers, HEADER_ALIASES.status),
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
  const service = rawService ? normalizeServiceType(rawService) : null;

  if (!rawDate || !service || rawLeadNumber === "") {
    return null;
  }

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    date: date.toISOString().slice(0, 10),
    location: normalizeLocation(
      readCell(row, indices.location, MISSING_LOCATION_LABEL),
    ),
    service,
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

async function applyBookedAppointments(rows: DashboardRow[]) {
  try {
    const bookedAppointments = await loadBookedAppointmentCounts();

    if (!bookedAppointments || bookedAppointments.counts.size === 0) {
      return {
        rows,
        warning:
          bookedAppointments?.warning ??
          "No usable booked appointment rows were found in the appointments CM tab.",
      };
    }

    const assignedSegments = new Set<string>();
    const rowSegments = new Set<string>();
    const rowsWithBookedAppointments = rows.map((row) => {
      const key = getSpendKey(row.date, row.location, row.service);
      rowSegments.add(key);
      const booked = bookedAppointments.counts.get(key) ?? 0;

      if (assignedSegments.has(key)) {
        return { ...row, booked: 0 };
      }

      assignedSegments.add(key);
      return { ...row, booked };
    });

    const appointmentOnlyRows = Array.from(bookedAppointments.counts.entries())
      .filter(([key]) => !rowSegments.has(key))
      .map(([key, booked]) => {
        const { date, location, service } = parseSpendKey(key);

        return {
          date,
          location,
          service,
          leads: 0,
          booked,
          canceled: 0,
          spend: 0,
        };
      });

    return {
      rows: [...rowsWithBookedAppointments, ...appointmentOnlyRows].sort(
        (left, right) => left.date.localeCompare(right.date),
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load booked appointment data.";

    return {
      rows,
      warning: `${message} Showing booked appointment values from the lead sheet.`,
    };
  }
}

async function loadBookedAppointmentCounts(): Promise<{
  counts: Map<string, number>;
  warning?: string;
} | null> {
  const spreadsheetId =
    process.env.GOOGLE_BOOKED_APPOINTMENTS_SPREADSHEET_ID ??
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ??
    DEFAULT_BOOKED_APPOINTMENTS_SPREADSHEET_ID;
  const auth = getGoogleAuth();

  if (!spreadsheetId || !auth) {
    return null;
  }

  const sheets = google.sheets({ version: "v4", auth });
  const range =
    process.env.GOOGLE_BOOKED_APPOINTMENTS_RANGE ??
    DEFAULT_BOOKED_APPOINTMENTS_RANGE;
  const response = await getBookedAppointmentsValues(sheets, spreadsheetId, range);
  const values = response.data.values ?? [];

  if (values.length < 2) {
    return null;
  }

  const headerRowIndex = findBookedAppointmentsHeaderRow(values);
  const headers = values[headerRowIndex].map((value) => normalizeHeader(value));
  const indices = {
    date: findHeaderIndex(headers, BOOKED_APPOINTMENT_HEADER_ALIASES.date),
    location: findHeaderIndex(headers, BOOKED_APPOINTMENT_HEADER_ALIASES.location),
    service: findHeaderIndex(headers, BOOKED_APPOINTMENT_HEADER_ALIASES.service),
    status: findHeaderIndex(headers, BOOKED_APPOINTMENT_HEADER_ALIASES.status),
  };

  if (indices.date === -1) {
    throw new Error(
      "The appointments CM tab needs an appointment date column for booked appointment mapping.",
    );
  }

  const appointmentsBySegment = new Map<string, number>();
  let skippedRows = 0;

  values.slice(headerRowIndex + 1).forEach((row) => {
    const date = normalizeDateInput(row[indices.date]);
    const service = inferAppointmentService(row, indices.service);

    if (!date || !service || isExcludedAppointment(row, indices.status, date)) {
      skippedRows += 1;
      return;
    }

    const location = normalizeLocation(
      readCell(row, indices.location, MISSING_LOCATION_LABEL),
    );
    const key = getSpendKey(date, location, service);
    appointmentsBySegment.set(key, (appointmentsBySegment.get(key) ?? 0) + 1);
  });

  return {
    counts: appointmentsBySegment,
    warning:
      appointmentsBySegment.size === 0 && skippedRows > 0
        ? `${skippedRows} appointment rows were read, but none matched a supported service/date/status.`
        : undefined,
  };
}

function findBookedAppointmentsHeaderRow(values: string[][]) {
  const searchLimit = Math.min(values.length, 20);

  for (let index = 0; index < searchLimit; index += 1) {
    const headers = values[index].map((value) => normalizeHeader(value));
    const dateIndex = findHeaderIndex(
      headers,
      BOOKED_APPOINTMENT_HEADER_ALIASES.date,
    );

    if (dateIndex !== -1) {
      return index;
    }
  }

  return 0;
}

async function getBookedAppointmentsValues(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  range: string,
) {
  try {
    return await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
  } catch (error) {
    if (!isRangeParseError(error)) {
      throw error;
    }

    const fallbackRange = await resolveBookedAppointmentsRange(
      sheets,
      spreadsheetId,
    );
    return sheets.spreadsheets.values.get({
      spreadsheetId,
      range: fallbackRange,
    });
  }
}

async function resolveBookedAppointmentsRange(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,hidden)",
  });
  const sheetTitle = metadata.data.sheets
    ?.filter((sheet) => !sheet.properties?.hidden)
    .map((sheet) => sheet.properties?.title)
    .find((title): title is string =>
      Boolean(title && /appointments?\s*cm/i.test(title)),
    );

  if (!sheetTitle) {
    throw new Error("The appointments CM tab could not be found.");
  }

  return `${quoteSheetName(sheetTitle)}!A:Z`;
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
    const spendBySegment =
      (await loadExportedGoogleAdsSpend(rows)) ??
      (await loadGoogleAdsDailySpend(rows));
    if (!spendBySegment) {
      return { rows };
    }

    const leadsBySegment = rows.reduce<Record<string, number>>(
      (accumulator, row) => {
        const key = getSpendKey(row.date, row.location, row.service);
        accumulator[key] = (accumulator[key] ?? 0) + row.leads;
        return accumulator;
      },
      {},
    );

    return {
      rows: [
        ...rows.map((row) => {
        const key = getSpendKey(row.date, row.location, row.service);
        const segmentSpend = spendBySegment.get(key);
        const segmentLeads = leadsBySegment[key] ?? 0;

        if (!segmentSpend || segmentLeads === 0) {
          return { ...row, spend: 0 };
        }

        return {
          ...row,
          spend: (segmentSpend * row.leads) / segmentLeads,
        };
        }),
        ...Array.from(spendBySegment.entries())
          .filter(([key]) => !leadsBySegment[key])
          .map(([key, spend]) => {
            const { date, location, service } = parseSpendKey(key);

            return {
              date,
              location,
              service,
              leads: 0,
              booked: 0,
              canceled: 0,
              spend,
            };
          }),
      ].sort((left, right) => left.date.localeCompare(right.date)),
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

async function loadExportedGoogleAdsSpend(rows: DashboardRow[]): Promise<SpendMap | null> {
  if (rows.length === 0) {
    return null;
  }

  const spreadsheetId =
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ??
    DEFAULT_GOOGLE_SHEETS_SPREADSHEET_ID;
  const auth = getGoogleAuth();
  if (!spreadsheetId || !auth) {
    return null;
  }

  const rowDates = rows.map((row) => row.date).sort();
  const dateFrom = rowDates[0];
  const dateTo = rowDates.at(-1);
  if (!dateFrom || !dateTo) {
    return null;
  }

  const sheets = google.sheets({ version: "v4", auth });
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,hidden)",
  });
  const visibleSheetTitles =
    metadata.data.sheets
      ?.filter((sheet) => !sheet.properties?.hidden)
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title)) ?? [];
  const locationSheets = resolveAdsSpendSheets(visibleSheetTitles);

  if (locationSheets.length === 0) {
    return null;
  }

  const spendBySegment: SpendMap = new Map();

  for (const locationSheet of locationSheets) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheetName(locationSheet.sheetName)}!A:H`,
    });
    const values = response.data.values ?? [];
    const rowsForSheet = readAdsSpendRows(
      values,
      locationSheet.location,
      dateFrom,
      dateTo,
    );

    rowsForSheet.forEach((row) => {
      const key = getSpendKey(row.date, row.location, row.service);
      spendBySegment.set(key, (spendBySegment.get(key) ?? 0) + row.spend);
    });
  }

  return spendBySegment.size > 0 ? spendBySegment : null;
}

function resolveAdsSpendSheets(sheetTitles: string[]) {
  const overrides = [
    {
      location: "San Diego",
      sheetName: process.env.GOOGLE_ADS_SPEND_SHEET_SAN_DIEGO,
    },
    {
      location: "Texas",
      sheetName: process.env.GOOGLE_ADS_SPEND_SHEET_TEXAS,
    },
  ]
    .filter((entry): entry is { location: string; sheetName: string } =>
      Boolean(entry.sheetName),
    )
    .filter((entry) => sheetTitles.includes(entry.sheetName));

  if (overrides.length > 0) {
    return overrides;
  }

  return ADS_SPEND_LOCATIONS.flatMap((location) => {
    const explicitSheet = findAdsSpendSheetForLocation(sheetTitles, location);
    if (explicitSheet) {
      return [{ location, sheetName: explicitSheet }];
    }

    if (
      location === "San Diego" &&
      sheetTitles.includes(ADS_SPEND_REPORT_TITLE)
    ) {
      return [{ location, sheetName: ADS_SPEND_REPORT_TITLE }];
    }

    return [];
  });
}

function findAdsSpendSheetForLocation(sheetTitles: string[], location: string) {
  const locationNeedles =
    location === "Texas" ? ["texas", "tx"] : ["san diego", "sandiego", "sd"];

  return sheetTitles.find((title) => {
    const normalizedTitle = title.toLowerCase();
    return (
      normalizedTitle.includes("ads spent report") &&
      locationNeedles.some((needle) => normalizedTitle.includes(needle))
    );
  });
}

function readAdsSpendRows(
  values: string[][],
  location: string,
  dateFrom: string,
  dateTo: string,
): AdsSpendRow[] {
  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map((value) => normalizeHeader(value));
  let indices = {
    date: findHeaderIndex(headers, ["date"]),
    service: findHeaderIndex(headers, ["service type", "service"]),
    cost: findHeaderIndex(headers, [
      "cost (usd)",
      "cost usd",
      "cost",
      "amount spent",
      "spend",
      "ad spend",
    ]),
  };
  let firstDataRowIndex = 1;

  if (indices.date === -1 || indices.service === -1 || indices.cost === -1) {
    const firstCellDate = normalizeDateInput(values[0][0]);
    if (!firstCellDate) {
      return [];
    }

    indices = {
      date: 0,
      service: 1,
      cost: 5,
    };
    firstDataRowIndex = 0;
  }

  const rows: AdsSpendRow[] = [];

  values.slice(firstDataRowIndex).forEach((row) => {
    const date = normalizeDateInput(row[indices.date]);
    const service = normalizeServiceType(row[indices.service] ?? "");
    const spend = readNumber(row, indices.cost, 0);

    if (!date || !service || spend <= 0 || date < dateFrom || date > dateTo) {
      return;
    }

    rows.push({ date, location, service, spend });
  });

  return rows;
}

async function loadGoogleAdsDailySpend(rows: DashboardRow[]): Promise<SpendMap | null> {
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
  const spendBySegment: SpendMap = new Map();

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

        const dailySpend = costMicros / 1_000_000;

        ADS_SPEND_LOCATIONS.forEach((location) => {
          ALLOWED_SERVICES.forEach((service) => {
            const key = getSpendKey(date, location, service);
            spendBySegment.set(
              key,
              (spendBySegment.get(key) ?? 0) +
                dailySpend / (ADS_SPEND_LOCATIONS.length * ALLOWED_SERVICES.length),
            );
          });
        });
      });
    });
  }

  return spendBySegment;
}

export function getGoogleAdsConfig() {
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
    const parsed = JSON.parse(errorText) as
      | Array<{
          error?: GoogleApiError;
        }>
      | {
          error?: GoogleApiError;
        };
    const error = Array.isArray(parsed)
      ? parsed.find((entry) => entry.error)?.error
      : parsed.error;
    const googleAdsError: GoogleApiErrorDetailItem | undefined = error?.details
      ?.flatMap((detail) => detail.errors ?? detail.fieldViolations ?? [])
      .find(Boolean);
    const errorCode = googleAdsError?.errorCode
      ? Object.values(googleAdsError.errorCode).join(", ")
      : error?.status;
    const message =
      googleAdsError?.message ?? googleAdsError?.description ?? error?.message;

    return (
      [errorCode, message].filter(Boolean).join(": ") ||
      summarizeParsedError(parsed)
    );
  } catch {
    return errorText.slice(0, 240);
  }
}

function isRangeParseError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /unable to parse range|range/i.test(error.message);
}

type GoogleApiError = {
  code?: number;
  message?: string;
  status?: string;
  details?: Array<{
    errors?: Array<{
      message?: string;
      description?: string;
      errorCode?: Record<string, string>;
    }>;
    fieldViolations?: Array<{
      description?: string;
      errorCode?: Record<string, string>;
    }>;
  }>;
};

type GoogleApiErrorDetailItem = {
  message?: string;
  description?: string;
  errorCode?: Record<string, string>;
};

function summarizeParsedError(parsed: unknown) {
  try {
    return JSON.stringify(parsed)
      .replace(/\s+/g, " ")
      .slice(0, 240);
  } catch {
    return "Unknown Google Ads API error.";
  }
}

function combineWarnings(...warnings: Array<string | undefined>) {
  const activeWarnings = warnings.filter((warning): warning is string =>
    Boolean(warning),
  );

  return activeWarnings.length > 0 ? activeWarnings.join(" ") : undefined;
}

export async function getGoogleAdsAccessToken(
  config: NonNullable<ReturnType<typeof getGoogleAdsConfig>>,
) {
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

function getSpendKey(date: string, location: string, service: string) {
  return [date, normalizeLocation(location), service].join("|");
}

function parseSpendKey(key: string) {
  const [date, location, service] = key.split("|");

  return {
    date: date ?? "",
    location: location ?? MISSING_LOCATION_LABEL,
    service: service ?? "Home",
  };
}

function normalizeDateInput(value?: string) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDate(parsed);
  }

  return null;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
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

  if (!row[index]?.trim()) {
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

function isExcludedAppointment(row: string[], statusIndex: number, date: string) {
  const status = statusIndex === -1 ? "" : row[statusIndex] ?? "";
  const appointmentDate = new Date(`${date}T00:00:00`);

  return (
    /cancel|cancelled|canceled/i.test(status) ||
    appointmentDate.getDay() === 6
  );
}

function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function normalizeServiceType(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  const service = ALLOWED_SERVICES.find((allowedService) =>
    normalized.startsWith(allowedService.toLowerCase()),
  );

  return service ?? null;
}

function normalizeAppointmentServiceType(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (/\bbath(?:room)?\b/.test(normalized)) {
    return "Bathroom";
  }

  if (/\bkitchen\b/.test(normalized)) {
    return "Kitchen";
  }

  if (/\bhome\b/.test(normalized)) {
    return "Home";
  }

  return null;
}

function inferAppointmentService(row: string[], serviceIndex: number) {
  const directService =
    serviceIndex === -1
      ? null
      : normalizeAppointmentServiceType(row[serviceIndex] ?? "");

  if (directService) {
    return directService;
  }

  for (const cell of row) {
    const service = normalizeAppointmentServiceType(cell ?? "");
    if (service) {
      return service;
    }
  }

  return null;
}

function normalizeLocation(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.includes("texas") || normalized.includes("dallas")) {
    return "Texas";
  }

  if (normalized.includes("san diego")) {
    return "San Diego";
  }

  return "San Diego";
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
