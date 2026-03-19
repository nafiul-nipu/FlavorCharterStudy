# FlavorCharterStudy

Standalone web-based study app for evaluating:

- distribution-aware radial profile vs grouped bar and violin plots
- Z-score radar vs overlaid radar charts

This app is intentionally isolated from the existing `FlavorCharterTool`
interface.

## Planned workflow

1. Generate static study data from `FlavorCharterTool/backend/data/users.json`
2. Run the standalone app locally
3. Build and host on GitHub Pages
4. Configure a Google Apps Script endpoint for response collection

## Commands

```bash
npm install
npm run generate-study-pack
npm run dev
```

## Recommended response collection

The best no-database setup for GitHub hosting is:

1. Host the built app on GitHub Pages.
2. Collect submissions through a Google Apps Script web app.
3. Store rows in Google Sheets.

This works well because:

- the frontend stays fully static
- participants do not need to download or upload files manually
- responses are written immediately to a spreadsheet
- there is no server or database to maintain

## Step-by-step setup

### 1. Create a Google Sheet

Create a blank Google Sheet for the study results.

### 2. Create an Apps Script project

In the Google Sheet:

1. Open `Extensions` -> `Apps Script`
2. Replace the default script with:
   [Code.gs](/Users/nafiulnipu/Desktop/RA_Projects/Flavor-charter-project/FlavorCharter/FlavorCharterStudy/docs/google-apps-script/Code.gs)
3. Replace `SPREADSHEET_ID` with your spreadsheet id

### 3. Deploy the script as a web app

In Apps Script:

1. Click `Deploy`
2. Choose `New deployment`
3. Select `Web app`
4. Set access so the study participants can submit
5. Copy the deployed `/exec` URL

### 4. Configure the frontend endpoint

Create a local env file:

```bash
cp .env.example .env
```

Then set:

```bash
VITE_STUDY_RESPONSE_ENDPOINT=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

### 5. Build and publish

```bash
npm run generate-study-pack
npm run build
```

Then publish the build output to GitHub Pages.

## What the app submits

The frontend currently submits:

- participant id
- session start / submit timestamps
- consent status
- background answers
- all trial responses
- subjective ratings
- final preferences
- final comment

## Files related to saving

- [sync.ts](/Users/nafiulnipu/Desktop/RA_Projects/Flavor-charter-project/FlavorCharter/FlavorCharterStudy/src/lib/sync.ts)
- [storage.ts](/Users/nafiulnipu/Desktop/RA_Projects/Flavor-charter-project/FlavorCharter/FlavorCharterStudy/src/lib/storage.ts)
- [Code.gs](/Users/nafiulnipu/Desktop/RA_Projects/Flavor-charter-project/FlavorCharter/FlavorCharterStudy/docs/google-apps-script/Code.gs)
- [.env.example](/Users/nafiulnipu/Desktop/RA_Projects/Flavor-charter-project/FlavorCharter/FlavorCharterStudy/.env.example)
