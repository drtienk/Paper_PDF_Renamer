# Paper PDF Renamer (Next.js + TypeScript)

這個 repo 根目錄就是一個可直接執行的 Next.js (App Router) + TypeScript 專案。

功能流程（全在瀏覽器端，不上傳 PDF 到伺服器）：

1. 上傳 PDF
2. 使用 `pdfjs-dist` 讀取文字並偵測 DOI
3. 若偵測到多個 DOI，提供下拉選單讓你切換
4. 若無 DOI，顯示「找不到 DOI」並可手動輸入 DOI 重新查詢
5. 使用 DOI 呼叫 Crossref API 取得 `title / author / year / journal`
6. 自動產生新檔名：`{year} - {firstAuthor} - {shortTitle} - {doi}.pdf`
7. 檔名會做非法字元清理與長度限制
8. 按 `Download` 下載同一份 PDF，但檔名改為新格式

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- React
- pdfjs-dist
- Crossref REST API

## 安裝與啟動

### 1) 安裝依賴

```bash
npm install
```

### 2) 開發模式

```bash
npm run dev
```

打開 <http://localhost:3000>

### 3) 產生正式版 build

```bash
npm run build
```

### 4) 啟動正式版

```bash
npm run start
```

## 補充

- 本專案不包含後端 API，也不會將 PDF 上傳到伺服器。
- 需要網路連線才能存取 Crossref API。
