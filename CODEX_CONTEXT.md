# CODEX_CONTEXT

## 1) Project Overview
- **Framework:** Next.js `14.2.5`.
- **Router type:** **App Router** (`app/` directory, `app/layout.tsx`, `app/page.tsx`).
- **Language:** TypeScript (`.tsx`, typed state/helpers in `app/page.tsx`).
- **Deployment target (detectable):**
  - No explicit platform config files (no `vercel.json`, no GitHub Pages workflow).
  - Typical target is Node-hosted Next.js (`next start`) and Vercel-compatible by default.

## Relevant file tree (current)
```text
.
├─ app/
│  ├─ globals.css
│  ├─ layout.tsx
│  └─ page.tsx
├─ package.json
├─ tsconfig.json
├─ next.config.mjs
└─ next-env.d.ts
```
- `pages/` not present.
- `components/`, `lib/`, `src/`, `api/` not present.

## 2) Current Single-File Pipeline (as-is)
### Entry UI component(s)
- `app/page.tsx`
  - Single client component (`"use client"`) containing upload UI, DOI selection/manual input, metadata preview, filename preview, and download action.

### Step-by-step flow
1. **Upload / Drop PDF**
   - File input `onUpload` or drag-drop `onDrop` (PDF-only check).
2. **Parse PDF text**
   - `extractTextFromPdf(file)` loads PDF via `pdfjs-dist` and concatenates text from all pages.
3. **Detect DOI(s)**
   - `findDois(text)` applies `DOI_REGEX`, normalizes with `cleanDoi`, deduplicates.
4. **Fetch metadata**
   - `lookupDoi(doi)` calls `fetchCrossref(doi)` (`https://api.crossref.org/works/{doi}`).
5. **Rename generation**
   - `filename` (`useMemo`) composes: `{year} - {firstAuthor} - {shortTitle} - {journalAbbr}.pdf`.
6. **Download**
   - `onDownload()` creates a Blob from the original PDF bytes and triggers anchor download with `anchor.download = filename`.

### State/progress tracking
- In `app/page.tsx` via React state:
  - `pdfFile`, `allDois`, `selectedDoi`, `manualDoi`, `metadata`, `status`, `loading`, `isDragOver`, `lang`.
- `status` string + `loading` are the primary progress indicators.

## 3) Key Files & Functions (most important)
- **`app/page.tsx`**
  - `extractTextFromPdf(file: File): Promise<string>`
    - Uses `pdfjsLib.getDocument({ data })`, iterates pages, reads `getTextContent()`.
  - pdf.js worker setup
    - `pdfjsLib.GlobalWorkerOptions.workerSrc = https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`.
  - DOI detection
    - `DOI_REGEX = /10\.\d{4,9}\/[\w.()/:;-]+/gi`
    - `cleanDoi()` strips DOI URL prefix, spaces, punctuation tail.
    - `findDois()` deduplicates matched/cleaned values.
  - Metadata fetch
    - `fetchCrossref(doi)` → GET `https://api.crossref.org/works/{doi}`.
    - Response shape expected: `{ message?: CrossrefWork }`; throws if missing/non-OK.
  - Rename logic
    - `getYear`, `getFirstAuthor`, `getShortTitle`, `getJournalAbbr`, `sanitizeFilename`, `truncate`, `safeSegment`.
    - `getJournalAbbr` removes stop words (`of`, `and`, `the`, `in`) and joins initials.
    - No explicit collision handling; single-file mode only.
  - Download logic
    - `onDownload()` uses `Blob` + `URL.createObjectURL` + temporary `<a>` click.

- **`app/layout.tsx`**
  - Exports `metadata` and root HTML/body wrapper.

- **`app/globals.css`**
  - Core UI styles including drop zone and language toggle classes.

## 4) Data Types / Interfaces
- `CrossrefAuthor`
  - `{ family?: string; given?: string; name?: string }`
- `CrossrefWork`
  - `{ title?: string[]; author?: CrossrefAuthor[]; issued?: { "date-parts"?: number[][] }; "container-title"?: string[]; DOI?: string }`
- `Lang`
  - `"en" | "zh"`

## 5) Constraints / Risks
- **Crossref API limits/reliability:** no backoff/retry queue; batch mode may hit rate limits.
- **Browser-only CORS/network dependency:** metadata lookup fails offline or if endpoint throttles.
- **pdf.js worker from CDN:** runtime depends on `unpkg` availability/version path.
- **Memory/performance:** full text extraction over many/large PDFs can be heavy in one tab.
- **Error granularity:** a single `status` string; no per-file error model yet.
- **Batch gap:** currently state model is single-file oriented (one `pdfFile`, one `metadata`, one `filename`).

## 6) Commands
From `package.json` scripts:
- `npm run dev` → `next dev`
- `npm run build` → `next build`
- `npm run start` → `next start`
- `npm run lint` → `next lint`

## Batch-flow implementation notes (actionable)
- Introduce a per-file job model (e.g., `jobs: Array<{id,file,status,dois,selectedDoi,metadata,filename,error}>`).
- Reuse existing helpers unchanged (`extractTextFromPdf`, `findDois`, `fetchCrossref`, filename helpers) per job.
- Add controlled concurrency for metadata requests (e.g., 2–5 parallel).
- Replace single `status` with per-job status + aggregate progress.
- Add ZIP export or sequential multi-download trigger as final output strategy.
