# Craftsmanship Marketing Dashboard Handoff

## Overview

This dashboard is a private Vercel-hosted reporting app for marketing performance. It reads lead data and Google Ads spend exports from a Google Sheet, then displays performance by location, service, and date range.

The dashboard is password protected. There is no username login.

## Live App

- Production app: `https://craftsmanship-marketing.vercel.app`
- Hosting platform: Vercel
- Framework: Next.js
- Data source: Google Sheets

## Current Data Sources

### Lead Data

Lead data is read from the primary Google Sheet tab configured in:

```text
GOOGLE_SHEETS_RANGE
```

Default expected range:

```text
Sheet1!A:Z
```

The lead sheet should include these columns:

```text
Creation Date
Name
Number
Email
Conversion Type
Attribution Source
Service Type
Estimated
Lead Source
Company
```

Booked appointment totals are supplied separately from the `appointments CM` tab. This tab only feeds the `Booked Appts` metric and does not change lead counts, spend, locations, or other lead-source fields.

Default booked appointments range:

```text
appointments CM!A:Z
```

### Google Ads Spend Data

Google Ads spend is read from Google Ads export tabs in the same spreadsheet.

Expected tabs:

```text
Ads Spent Report
Ads Spent Report Texas
```

Location mapping:

```text
Ads Spent Report       -> San Diego
Ads Spent Report Texas -> Texas
```

Expected Google Ads export columns:

```text
Date
Service Type
Ad Group Name
Impressions
Clicks
Cost (USD)
Conversions
Cost Per Conversion
```

The dashboard reads `Date`, `Service Type`, and `Cost (USD)`.

## Dashboard Rules

### Locations

Only these dashboard locations are shown:

```text
San Diego
Texas
```

Company/location values from the lead sheet are normalized:

```text
San Diego, SD, Creative Design & Build San Diego -> San Diego
Texas, TX, Dallas, Creative Design & Build Texas -> Texas
```

### Services

Only these services are shown:

```text
All
Bathroom
Kitchen
Home
```

Service values are normalized by the first matching service family:

```text
Bathroom Remodel -> Bathroom
Kitchen Remodel  -> Kitchen
Home Remodel     -> Home
Home Addition    -> Home
```

Rows outside these service families are excluded from dashboard metrics.

### Leads

Lead count is based on rows with a populated `Number` column.

### Booked Appointments

Booked appointments are counted from the booked column when present. If that cell is blank, the dashboard checks `Conversion Type`.

The following conversion type values count as booked appointments:

```text
Calendar Appointment
Appointment
Booking
Booked
Estimate
```

### Spend Allocation

Google Ads spend is matched by:

```text
Date + Location + Service
```

If spend exists for a date/location/service with matching leads, the spend is allocated across those leads.

If spend exists but there are no matching leads for that segment, the dashboard still displays the spend as a spend-only row so the total ad spend is not lost.

## Required Accounts

The client should have access to:

```text
Google Account
Google Sheets file
Google Ads account
Google Ads Scripts access
GitHub account or organization
Vercel account or team
Google Cloud project
```

## Required Environment Variables

Set these in Vercel under:

```text
Project -> Settings -> Environment Variables
```

Apply them to:

```text
Production
Preview, if preview deployments are needed
```

### Required App Variables

```text
DASHBOARD_PASSWORD
DASHBOARD_SESSION_TOKEN
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SHEETS_RANGE
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
NEXT_PUBLIC_REFRESH_MS
```

Recommended refresh interval:

```text
NEXT_PUBLIC_REFRESH_MS=300000
```

This refreshes the browser data every 5 minutes.

### Optional Booked Appointment Variables

These are only needed if the booked appointment source is moved to a different spreadsheet or tab.

```text
GOOGLE_BOOKED_APPOINTMENTS_SPREADSHEET_ID
GOOGLE_BOOKED_APPOINTMENTS_RANGE
```

Default booked appointment range:

```text
GOOGLE_BOOKED_APPOINTMENTS_RANGE=appointments CM!A:Z
```

### Optional Google Sheets Service Account Variables

These are optional if OAuth access is working.

```text
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
GOOGLE_PRIVATE_KEY_B64_1
GOOGLE_PRIVATE_KEY_B64_2
GOOGLE_PRIVATE_KEY_B64_3
```

### Optional Direct Google Ads API Variables

The current production data flow uses Google Ads Scripts exporting spend to Google Sheets. These direct API variables are optional and can be left unset unless direct API reporting is restored later.

```text
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CUSTOMER_ID
GOOGLE_ADS_LOGIN_CUSTOMER_ID
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REFRESH_TOKEN
GOOGLE_ADS_API_VERSION
```

Recommended API version if used:

```text
GOOGLE_ADS_API_VERSION=v22
```

### Optional Google Ads Export Tab Overrides

These are only needed if the export tabs are renamed.

```text
GOOGLE_ADS_SPEND_SHEET_SAN_DIEGO
GOOGLE_ADS_SPEND_SHEET_TEXAS
```

Default tab names:

```text
GOOGLE_ADS_SPEND_SHEET_SAN_DIEGO=Ads Spent Report
GOOGLE_ADS_SPEND_SHEET_TEXAS=Ads Spent Report Texas
```

## Google Sheet Setup

1. Create or copy the lead report spreadsheet.
2. Confirm the main lead tab has the required lead columns.
3. Confirm the Google Ads export tabs exist:

```text
Ads Spent Report
Ads Spent Report Texas
```

4. Share the spreadsheet with the Google account used for OAuth.
5. If using a service account, share the spreadsheet with the service account email.
6. Copy the spreadsheet ID from the URL.

Example:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

Use that value for:

```text
GOOGLE_SHEETS_SPREADSHEET_ID
```

## Google Ads Spend Export Setup

The recommended setup is to use Google Ads Scripts inside each Google Ads account to export spend into the shared Google Sheet.

### San Diego Script

Export San Diego Google Ads data into:

```text
Ads Spent Report
```

### Texas Script

Export Texas Google Ads data into:

```text
Ads Spent Report Texas
```

### Export Requirements

Each script should export rows with these columns:

```text
Date
Service Type
Ad Group Name
Impressions
Clicks
Cost (USD)
Conversions
Cost Per Conversion
```

The dashboard currently uses:

```text
Date
Service Type
Cost (USD)
```

### Recommended Trigger

Set a daily trigger in Google Ads Scripts. A common schedule is:

```text
Daily at 6:00 AM account timezone
```

If hourly spend updates are required, create an hourly trigger or adjust the Ads Script schedule.

## Google Cloud OAuth Setup

1. Go to Google Cloud Console.
2. Create or open the client’s Google Cloud project.
3. Enable the Google Sheets API.
4. Open `APIs & Services -> OAuth consent screen`.
5. Configure the consent screen.
6. Open `APIs & Services -> Credentials`.
7. Create an OAuth Client ID.
8. Select application type based on the token-generation method being used.
9. Generate a refresh token with Google Sheets access.
10. Add the OAuth values to Vercel:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
```

Required OAuth scope:

```text
https://www.googleapis.com/auth/spreadsheets.readonly
```

If the same OAuth credential must edit the spreadsheet, use:

```text
https://www.googleapis.com/auth/spreadsheets
```

## Manual Vercel Duplication Guide

Use these steps to duplicate the app into the client’s own Vercel account.

### 1. Prepare The Code Repository

Option A: Use GitHub

1. Create a new GitHub repository in the client’s GitHub account or organization.
2. Copy or push the dashboard code into that repository.
3. Confirm the repository includes:

```text
app/
components/
lib/
public/
package.json
package-lock.json
next.config, if present
vercel.json
```

Option B: Create A New Vercel Project From The Repository

1. Open Vercel.
2. Select the client team.
3. Click `Add New -> Project`.
4. Import the GitHub repository.
5. Continue with the configuration steps below.

### 2. Configure The Vercel Project

In Vercel:

1. Select the imported project.
2. Set the framework preset to:

```text
Next.js
```

3. Confirm build command:

```text
npm run build
```

4. Confirm install command:

```text
npm install
```

5. Confirm output directory is left as the Vercel default for Next.js.

### 3. Add Environment Variables

Go to:

```text
Project -> Settings -> Environment Variables
```

Add each required variable from the `Required Environment Variables` section.

Set all secret values as sensitive/encrypted where Vercel provides that option.

### 4. Deploy

1. Go to the Vercel project dashboard.
2. Click `Deployments`.
3. Trigger a new deployment if one has not already started.
4. Wait for deployment status:

```text
Ready
```

5. Open the generated Vercel URL.
6. Log in with the configured dashboard password.

### 5. Add A Custom Domain

If the client wants a branded URL:

1. Go to `Project -> Settings -> Domains`.
2. Add the custom domain.
3. Follow Vercel’s DNS instructions.
4. Wait for SSL provisioning to complete.

## Manual Local Setup

Local setup is optional but useful for testing changes before deployment.

1. Install Node.js.
2. Clone the repository.
3. Install dependencies:

```bash
npm install
```

4. Create `.env.local`.
5. Add the required environment variables.
6. Start the local app:

```bash
npm run dev
```

7. Open:

```text
http://localhost:3000
```

## Validation Checklist

After deployment, validate:

```text
Login works with the dashboard password.
Lead rows load from Google Sheets.
Location dropdown only shows San Diego and Texas.
Service pills show All, Bathroom, Kitchen, and Home.
Date range defaults to the current month.
Booked appointments include Calendar Appointment conversion types.
Amount Spent is populated from Ads Spent Report tabs.
Footer notice is empty when data loads correctly.
```

## Troubleshooting

### Dashboard Shows Sample Data

Check:

```text
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SHEETS_RANGE
GOOGLE_BOOKED_APPOINTMENTS_RANGE
Google Sheet sharing permissions
OAuth refresh token
Google Sheets API enabled in Google Cloud
```

### Amount Spent Shows $0

Check:

```text
Ads Spent Report tab exists.
Ads Spent Report Texas tab exists.
Date values match the dashboard date range.
Service Type contains Bathroom, Kitchen, Home Remodel, or Home Addition.
Cost (USD) contains numeric spend.
Google Ads Script ran successfully.
```

### Google Ads Export Does Not Update

Check:

```text
Google Ads Script trigger exists.
Google Ads Script has permission to write to the spreadsheet.
The script is attached to the correct Google Ads account.
The script writes to the correct tab name.
The Google Ads account has spend for the requested date.
```

### Password Does Not Work

Check:

```text
DASHBOARD_PASSWORD in Vercel Production
Latest deployment was created after changing the password
Browser cache/cookies
```

## Ongoing Maintenance

Recommended monthly checks:

```text
Confirm Google Ads Scripts are still running.
Confirm Google Sheets OAuth token is still valid.
Confirm Vercel deployments are successful.
Confirm spend totals match Google Ads for a sample date.
Review dashboard filters after service or location naming changes.
```

## Security Notes

Do not place secrets directly in the source code.

Store secrets only in:

```text
Vercel Environment Variables
Google Cloud Secret Manager, if used later
Google Apps Script Properties, for script-only tokens
```

Rotate credentials when:

```text
A team member leaves the project.
The Google Cloud project changes ownership.
The Google Ads account changes ownership.
The dashboard is moved to a new Vercel team.
```
