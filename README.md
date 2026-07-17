# Craftsmanship Marketing Dashboard

Private Vercel-ready dashboard for Google Sheets-backed marketing performance reporting.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` with:

```bash
DASHBOARD_PASSWORD=change-this-password
DASHBOARD_SESSION_TOKEN=change-this-session-token
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEETS_RANGE=Sheet1!A:Z
GOOGLE_BOOKED_APPOINTMENTS_SPREADSHEET_ID=optional_booked_appointments_spreadsheet_id
GOOGLE_BOOKED_APPOINTMENTS_RANGE=appointments CM!A:Z
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=base64_encoded_service_account_json
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_ADS_DEVELOPER_TOKEN=your_google_ads_developer_token
GOOGLE_ADS_CUSTOMER_ID=1234567890
GOOGLE_ADS_LOGIN_CUSTOMER_ID=optional_manager_account_id
GOOGLE_ADS_CLIENT_ID=optional_ads_oauth_client_id
GOOGLE_ADS_CLIENT_SECRET=optional_ads_oauth_client_secret
GOOGLE_ADS_REFRESH_TOKEN=optional_ads_refresh_token
GOOGLE_ADS_API_VERSION=v22
NEXT_PUBLIC_REFRESH_MS=300000
```

3. Run the app:

```bash
npm run dev
```

## Google Cloud setup

1. Create or open a Google Cloud project in the Google Cloud Console.
2. Enable the Google Sheets API for that project.
3. Go to `IAM & Admin` → `Service Accounts`.
4. Create a new service account for this dashboard.
5. Create a JSON key for that service account and copy:
   - preferred: base64 encode the full JSON file into `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`
   - Vercel CLI fallback: base64 encode `private_key` and split it into `GOOGLE_PRIVATE_KEY_B64_1`, `GOOGLE_PRIVATE_KEY_B64_2`, etc.
   - fallback: `client_email` into `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` into `GOOGLE_PRIVATE_KEY`
6. Open the target Google Sheet and share it with the service account email as a Viewer.
7. Copy the spreadsheet ID from the sheet URL into `GOOGLE_SHEETS_SPREADSHEET_ID`.

If the credentials are missing or the sheet cannot be read, the dashboard automatically falls back to sample data so the UI still renders.

## Google Ads spend

When Google Ads env vars are configured, `Amount Spent` is loaded from the Google Ads API by `segments.date` using `metrics.cost_micros`. Daily spend is divided by 1,000,000 and allocated across the leads for that same date, so dashboard date-range totals match Google Ads daily spend totals. If Google Ads env vars are missing, the dashboard falls back to the sheet spend column.
