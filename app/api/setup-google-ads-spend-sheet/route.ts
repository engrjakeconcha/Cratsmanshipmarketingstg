import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getAuthCookieName, isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_SPREADSHEET_ID = "1amSD2ll-WBWaq7TUK-Bzdms2vUVZ3nlfxjoMOH0xuZM";
const SHEET_TITLE = "Google Ads Spend";
const HEADERS = [
  "Date",
  "Location",
  "Amount Spent",
  "Campaign",
  "Source",
  "Notes",
  "Last Updated",
];

export async function POST() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(getAuthCookieName())?.value;

  if (!(await isAuthenticated(cookieValue))) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const spreadsheetId =
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? DEFAULT_SPREADSHEET_ID;
  const auth = getGoogleOAuthClient() ?? getGoogleServiceAccountClient();

  if (!auth) {
    return NextResponse.json(
      { ok: false, message: "Google Sheets credentials are not configured." },
      { status: 400 },
    );
  }

  const sheets = google.sheets({ version: "v4", auth });
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,index,gridProperties)",
  });
  const existingSheet = metadata.data.sheets?.find(
    (sheet) => sheet.properties?.title === SHEET_TITLE,
  );
  const sheetId = existingSheet?.properties?.sheetId ?? Date.now() % 1_000_000_000;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        ...(existingSheet
          ? []
          : [
              {
                addSheet: {
                  properties: {
                    sheetId,
                    title: SHEET_TITLE,
                    gridProperties: {
                      rowCount: 1000,
                      columnCount: HEADERS.length,
                      frozenRowCount: 1,
                    },
                  },
                },
              },
            ]),
        {
          updateCells: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: HEADERS.length,
            },
            rows: [
              {
                values: HEADERS.map((header) => ({
                  userEnteredValue: { stringValue: header },
                })),
              },
            ],
            fields: "userEnteredValue",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: HEADERS.length,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.07, green: 0.17, blue: 0.24 },
                horizontalAlignment: "CENTER",
                textFormat: {
                  bold: true,
                  foregroundColor: { red: 1, green: 1, blue: 1 },
                },
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)",
          },
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: "DATE",
                  pattern: "yyyy-mm-dd",
                },
              },
            },
            fields: "userEnteredFormat.numberFormat",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: "CURRENCY",
                  pattern: "$#,##0.00",
                },
              },
            },
            fields: "userEnteredFormat.numberFormat",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: HEADERS.length,
            },
          },
        },
      ],
    },
  });

  return NextResponse.json({
    ok: true,
    spreadsheetId,
    sheetTitle: SHEET_TITLE,
    created: !existingSheet,
    headers: HEADERS,
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

function getGoogleServiceAccountClient() {
  const credentials = getGoogleCredentials();
  if (!credentials) {
    return null;
  }

  return new google.auth.JWT({
    email: credentials.clientEmail,
    key: credentials.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
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

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
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
  return normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
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
