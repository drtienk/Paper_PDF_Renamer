# Paper PDF Renamer (Next.js + TypeScript)

這是一個純前端（client-side）PDF 重新命名工具：

1. 上傳 PDF（不會上傳到伺服器）
2. 用 `pdfjs-dist` 讀取文字並偵測 DOI
3. 用 DOI 呼叫 Crossref API 取得 metadata
4. 產生檔名：`{year} - {firstAuthor} - {shortTitle} - {doi}.pdf`
5. 下載同一份 PDF 但使用新檔名

若自動偵測不到 DOI，會顯示「找不到 DOI」並可手動輸入 DOI 查詢。

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- pdfjs-dist
- Crossref REST API

## Getting Started

### 1) Install

```bash
npm install
```

### 2) Run dev server

```bash
npm run dev
```

開啟 <http://localhost:3000>

### 3) Build

```bash
npm run build
```

### 4) Start production server

```bash
npm run start
```

## Notes

- 所有資料都在瀏覽器端處理，沒有後端、沒有伺服器儲存。
- 需要連網才能呼叫 Crossref API。
- 檔名會移除非法字元，並做長度限制。
