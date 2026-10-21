# AI API Key Uses in Hospital Management

A lightweight hospital management website with an AI-powered report assistant. The application runs in a browser and stores operational data locally, while a small Node.js server securely forwards report questions to the ChatterMate AI API.

## Features

- Hospital dashboard with patient, collection, and pending lab-test summaries
- Patient registration
- Doctor visit and prescription records
- Lab test tracking
- Billing and payment records
- Daily collection report
- Patient list report
- Doctor-wise report
- Lab test report
- AI Report Assistant for questions about the current report data
- Sample data generator with 20 patients, visits, lab tests, and payments
- Browser `localStorage` persistence for the hospital records

## Requirements

- Node.js 18 or newer
- A ChatterMate API key

Check your Node.js installation:

```powershell
node --version
```

## Setup

1. Open PowerShell in the project folder.

2. Create a file named `.env` in the same folder as `server.js`.

3. Add your ChatterMate API key:

## Run the website

Start the local server:

```powershell
node server.js
```

Open the website at:

<http://localhost:3000>

Keep the PowerShell window running while using the website. Do not open `index.html` directly, because the AI chat needs the `/ask` endpoint provided by `server.js`.

Stop the server with `Ctrl+C`.

## How the AI chat works

1. The browser sends the question and current report data to `POST /ask`.
2. The Node.js server reads the API key from `.env`.
3. The server requests the available ChatterMate model.
4. The server sends the report data and question to ChatterMate.
5. The server returns the generated answer to the browser.

The API key is kept on the server and is not placed in `index.html`.

## Troubleshooting

### “Error connecting to AI assistant server.”

Make sure that:

- The website was opened at `http://localhost:3000`, not by double-clicking `index.html`.
- `node server.js` is still running.
- `.env` is in the same folder as `server.js`.
- The variable is named exactly `CHATTERMATE_API_KEY`.
- The API key is valid and active.
- The PowerShell window does not show an `AI request failed` error.

### Port 3000 is already in use

Start the server on another port:

```powershell
$env:PORT=3001
node server.js
```

Then open <http://localhost:3001>.

## Project structure

```text
.
├── index.html   # Frontend interface and local hospital data logic
├── server.js    # Static web server and AI API proxy
├── .env         # Local API configuration; do not commit
└── README.md    # Setup and usage instructions
```

## Data and privacy

Hospital records are stored in the browser's `localStorage` and are specific to the browser profile. Clearing browser storage removes those records. When using the AI assistant, the current report data is sent to the configured ChatterMate API, so use only data that is appropriate for that service.

## License

No license has been specified yet. Add a license before distributing this project publicly.
