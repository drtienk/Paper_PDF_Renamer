"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

type CrossrefAuthor = {
  family?: string;
  given?: string;
  name?: string;
};

type CrossrefWork = {
  title?: string[];
  author?: CrossrefAuthor[];
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  DOI?: string;
};

type Lang = "en" | "zh";

const TEXT = {
  en: {
    title: "Paper PDF Renamer",
    subtitle: "Upload PDF → Detect DOI → Fetch Metadata → Download Renamed File",
    upload: "Upload PDF",
    dropHere: "Drag & drop a PDF here, or click to select",
    multiDoi: "Multiple DOIs detected:",
    manualPlaceholder: "Enter DOI manually",
    manualLookup: "Lookup DOI",
    metadata: "Metadata",
    metadataTitle: "Title:",
    metadataAuthor: "Author:",
    metadataYear: "Year:",
    metadataJournal: "Journal:",
    metadataDoi: "DOI:",
    notAvailable: "N/A",
    statusUpload: "Please upload a PDF.",
    statusParsing: "Parsing PDF text...",
    statusNoDoi: "No DOI found. Please enter it manually.",
    statusInvalidDoi: "Please enter a valid DOI.",
    statusFetching: "Fetching metadata from Crossref...",
    statusSuccess: "Metadata retrieved. You can download the renamed PDF.",
    statusErrorLookup: "Crossref lookup failed.",
    statusErrorPdf: "Error processing PDF.",
    download: "Download",
    newFilename: "New filename:",
    toggleEn: "EN",
    toggleZh: "中文",
  },
  zh: {
    title: "Paper PDF Renamer",
    subtitle: "上傳 PDF → 偵測 DOI → 查 Crossref → 下載新檔名",
    upload: "上傳 PDF",
    dropHere: "拖拉 PDF 到這裡，或點擊選擇檔案",
    multiDoi: "偵測到多個 DOI：",
    manualPlaceholder: "手動輸入 DOI",
    manualLookup: "查詢 DOI",
    metadata: "Metadata",
    metadataTitle: "Title:",
    metadataAuthor: "Author:",
    metadataYear: "Year:",
    metadataJournal: "Journal:",
    metadataDoi: "DOI:",
    notAvailable: "N/A",
    statusUpload: "請上傳 PDF。",
    statusParsing: "正在解析 PDF 文字...",
    statusNoDoi: "找不到 DOI，請手動輸入。",
    statusInvalidDoi: "請先輸入有效 DOI。",
    statusFetching: "正在查詢 Crossref...",
    statusSuccess: "已取得 metadata，可下載新檔名 PDF。",
    statusErrorLookup: "查詢 Crossref 失敗。",
    statusErrorPdf: "處理 PDF 時發生錯誤。",
    download: "下載",
    newFilename: "新檔名：",
    toggleEn: "EN",
    toggleZh: "中文",
  },
} satisfies Record<Lang, Record<string, string>>;

const DOI_REGEX = /10\.\d{4,9}\/[\w.()/:;-]+/gi;
const MAX_FILENAME_LENGTH = 180;
const MAX_SHORT_TITLE_LENGTH = 60;
const MAX_JOURNAL_ABBR_LENGTH = 40;
const JOURNAL_STOP_WORDS = new Set(["of", "and", "the", "in"]);

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

const cleanDoi = (value: string): string =>
  value
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/\s+/g, "")
    .replace(/[<>"']/g, "")
    .replace(/[).,;]+$/, "");

const sanitizeFilename = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? value.slice(0, maxLength) : value;

const safeSegment = (value: string, fallback: string): string => {
  const cleaned = sanitizeFilename(value);
  return cleaned.length > 0 ? cleaned : fallback;
};

async function extractTextFromPdf(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const chunks: string[] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    chunks.push(pageText);
  }

  return chunks.join("\n");
}

const findDois = (text: string): string[] => {
  const matches = text.match(DOI_REGEX) ?? [];
  return [...new Set(matches.map(cleanDoi).filter(Boolean))];
};

const getYear = (work: CrossrefWork): string => {
  const firstDate = work.issued?.["date-parts"]?.[0]?.[0];
  return firstDate ? String(firstDate) : "UnknownYear";
};

const getFirstAuthor = (work: CrossrefWork): string => {
  const first = work.author?.[0];
  if (!first) return "UnknownAuthor";
  return first.family ?? first.name ?? first.given ?? "UnknownAuthor";
};

const getShortTitle = (work: CrossrefWork): string => {
  const title = sanitizeFilename(work.title?.[0] ?? "Untitled");
  if (title.length <= MAX_SHORT_TITLE_LENGTH) {
    return title;
  }

  return `${title.slice(0, MAX_SHORT_TITLE_LENGTH)}-`;
};

const getJournalAbbr = (work: CrossrefWork): string => {
  const journal = sanitizeFilename(work["container-title"]?.[0] ?? "");
  if (!journal) {
    return "UnknownJournal";
  }

  const abbr = journal
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .filter((word) => !JOURNAL_STOP_WORDS.has(word.toLowerCase()))
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return truncate(abbr || "UnknownJournal", MAX_JOURNAL_ABBR_LENGTH);
};

async function fetchCrossref(doi: string): Promise<CrossrefWork> {
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (!response.ok) {
    throw new Error(`Crossref request failed (${response.status})`);
  }

  const payload = (await response.json()) as { message?: CrossrefWork };
  if (!payload.message) {
    throw new Error("Crossref response missing metadata");
  }

  return payload.message;
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const t = TEXT[lang];

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [allDois, setAllDois] = useState<string[]>([]);
  const [selectedDoi, setSelectedDoi] = useState<string>("");
  const [manualDoi, setManualDoi] = useState<string>("");
  const [metadata, setMetadata] = useState<CrossrefWork | null>(null);
  const [status, setStatus] = useState<string>(TEXT.en.statusUpload);
  const [loading, setLoading] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const filename = useMemo(() => {
    if (!metadata) return "";

    const year = safeSegment(getYear(metadata), "UnknownYear");
    const author = safeSegment(getFirstAuthor(metadata), "UnknownAuthor");
    const shortTitle = safeSegment(getShortTitle(metadata), "Untitled");
    const journalAbbr = safeSegment(getJournalAbbr(metadata), "UnknownJournal");
    const base = `${year} - ${author} - ${shortTitle} - ${journalAbbr}`;
    return `${truncate(base, MAX_FILENAME_LENGTH)}.pdf`;
  }, [metadata]);

  const lookupDoi = async (doi: string) => {
    setSelectedDoi(doi);
    setMetadata(null);
    setLoading(true);
    setStatus(t.statusFetching);

    try {
      const work = await fetchCrossref(doi);
      setMetadata(work);
      setStatus(t.statusSuccess);
    } catch {
      setStatus(t.statusErrorLookup);
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file: File) => {
    setPdfFile(file);
    setMetadata(null);
    setAllDois([]);
    setSelectedDoi("");
    setManualDoi("");
    setLoading(true);
    setStatus(t.statusParsing);

    try {
      const text = await extractTextFromPdf(file);
      const dois = findDois(text);
      setAllDois(dois);

      if (dois.length === 0) {
        setStatus(t.statusNoDoi);
        setLoading(false);
        return;
      }

      await lookupDoi(dois[0]);
    } catch {
      setStatus(t.statusErrorPdf);
      setLoading(false);
    }
  };

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleFile(file);
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setStatus(t.statusErrorPdf);
      return;
    }

    await handleFile(file);
  };

  const onManualLookup = async () => {
    const doi = cleanDoi(manualDoi);
    if (!doi) {
      setStatus(t.statusInvalidDoi);
      return;
    }
    await lookupDoi(doi);
  };

  const onDownload = async () => {
    if (!pdfFile || !filename) return;

    const bytes = await pdfFile.arrayBuffer();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="container">
      <div className="langToggle">
        <button type="button" onClick={() => setLang("en")} disabled={lang === "en"}>
          {t.toggleEn}
        </button>
        <button type="button" onClick={() => setLang("zh")} disabled={lang === "zh"}>
          {t.toggleZh}
        </button>
      </div>

      <h1>{t.title}</h1>
      <p className="subtitle">{t.subtitle}</p>

      <div
        className={`dropZone${isDragOver ? " dragOver" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragOver(false);
        }}
        onDrop={(event) => void onDrop(event)}
      >
        <p>{t.dropHere}</p>
        <label className="uploadButton" htmlFor="pdfUpload" aria-disabled={loading}>
          {t.upload}
        </label>
        <input id="pdfUpload" type="file" accept="application/pdf" onChange={onUpload} disabled={loading} />
      </div>

      {allDois.length > 1 && (
        <div className="field">
          <label htmlFor="doiSelect">{t.multiDoi}</label>
          <select id="doiSelect" value={selectedDoi} onChange={(event) => void lookupDoi(event.target.value)}>
            {allDois.map((doi) => (
              <option key={doi} value={doi}>
                {doi}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field inline">
        <input
          type="text"
          placeholder={t.manualPlaceholder}
          value={manualDoi}
          onChange={(event) => setManualDoi(event.target.value)}
          disabled={loading}
        />
        <button type="button" onClick={() => void onManualLookup()} disabled={loading}>
          {t.manualLookup}
        </button>
      </div>

      {metadata && (
        <section className="metadata">
          <h2>{t.metadata}</h2>
          <ul>
            <li>
              <strong>{t.metadataTitle}</strong> {metadata.title?.[0] ?? t.notAvailable}
            </li>
            <li>
              <strong>{t.metadataAuthor}</strong> {metadata.author?.map((a) => a.family ?? a.name).join(", ") ?? t.notAvailable}
            </li>
            <li>
              <strong>{t.metadataYear}</strong> {getYear(metadata)}
            </li>
            <li>
              <strong>{t.metadataJournal}</strong> {metadata["container-title"]?.[0] ?? t.notAvailable}
            </li>
            <li>
              <strong>{t.metadataDoi}</strong> {selectedDoi}
            </li>
          </ul>
        </section>
      )}

      <p className="status">{status}</p>

      <button type="button" onClick={() => void onDownload()} disabled={!filename || loading}>
        {t.download}
      </button>

      {filename && (
        <p className="filename">
          {t.newFilename} {filename}
        </p>
      )}
    </main>
  );
}
