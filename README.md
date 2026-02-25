# Paper PDF Renamer

This repository is now structured for direct Vercel deployment from the repository root.

## Root structure required by Vercel

- `package.json`
- `index.html`
- `src/`
- `vite.config.ts`
- `api/rename.py`
- `api/requirements.txt`

## Deploy to Vercel

1. Import this repository in Vercel.
2. Keep **Root Directory** empty (use repo root).
3. Build settings are handled by `vercel.json`:
   - `buildCommand`: `npm run build`
   - `outputDirectory`: `dist`
4. Deploy.

## Local development

```bash
npm install
npm run dev
```

## Build locally

```bash
npm run build
```
