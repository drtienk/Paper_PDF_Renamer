# PDF DOI Renamer

PDF DOI Renamer is a production-ready Vercel project that:

1. Accepts a PDF upload (up to 20MB).
2. Extracts text from the first 2 pages.
3. Finds a DOI using regex.
4. Fetches article metadata from Crossref with OpenAlex fallback.
5. Returns the same PDF file with a sanitized filename:
   `journal_year_author_title_doi.pdf`

## Stack

- Frontend: React + Vite + Tailwind CSS
- Backend: Vercel Python Serverless Function (`api/rename.py`)
- PDF parser: `pypdf`
- HTTP client: `requests`
- Multipart handling: robust multipart parser in the serverless function

## Project Structure

```text
.
├── api
│   ├── rename.py
│   └── requirements.txt
├── src
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── vercel.json
├── vite.config.ts
└── README.md
```

## Local Development

### Prerequisites

- Node.js 20+
- Python 3.9+
- Vercel CLI (`npm i -g vercel`)

### Install dependencies

```bash
npm install
pip install -r api/requirements.txt
```

### Run locally with Vercel

```bash
vercel dev
```

- Frontend will be served through Vercel dev server.
- API route available at `http://localhost:3000/api/rename`.

## Deploy to Vercel

```bash
vercel
```

For production:

```bash
vercel --prod
```

## API Contract

### Endpoint

`POST /api/rename`

### Request

- `Content-Type: multipart/form-data`
- File field name: `file`
- Constraints:
  - MIME type must be `application/pdf`
  - Magic bytes must start with `%PDF-`
  - Max size is 20MB

### Responses

- `200`: Returns original PDF bytes with renamed attachment filename
- `400`: Empty/malformed request or invalid PDF
- `404`: DOI not found in first 2 pages
- `413`: Payload too large
- `415`: Unsupported media type
- `405`: Method not allowed

### CORS

- Handles `OPTIONS` preflight (`204`)
- Adds:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: POST,OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type`
  - `Access-Control-Expose-Headers: Content-Disposition`

## Notes on Reliability & Security

- DOI regex: `10\.\d{4,9}/[\S]+`
- DOI normalization: lowercase + trims trailing punctuation
- Metadata lookup:
  - Primary: Crossref
  - Fallback: OpenAlex
  - Retries 5xx responses up to 2 additional attempts with backoff
- Filename sanitization:
  - strips newlines and unsafe chars
  - slugifies to lowercase alphanumeric and hyphens
  - max final filename length of 220 chars

## Build

```bash
npm run build
```

This outputs static frontend files to `dist/` (as configured by `vite.config.ts` and `vercel.json`).
