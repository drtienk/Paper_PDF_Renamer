"use client";

import { ChangeEvent, useMemo, useState } from "react";
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

const DOI_REGEX = /10\.\d{4,9}\/[\w.()/:;-]+/gi;
const MAX_FILENAME_LENGTH = 180;

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
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

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
  const title = work.title?.[0] ?? "Untitled";
  return truncate(title, 60);
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
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [allDois, setAllDois] = useState<string[]>([]);
  const [selectedDoi, setSelectedDoi] = useState<string>("");
  const [manualDoi, setManualDoi] = useState<string>("");
  const [metadata, setMetadata] = useState<CrossrefWork | null>(null);
  const [status, setStatus] = useState<string>("請上傳 PDF。");
  const [loading, setLoading] = useState<boolean>(false);

  const filename = useMemo(() => {
    if (!metadata || !selectedDoi) return "";

    const year = safeSegment(getYear(metadata), "UnknownYear");
    const author = safeSegment(getFirstAuthor(metadata), "UnknownAuthor");
    const shortTitle = safeSegment(getShortTitle(metadata), "Untitled");
    const normalizedDoi = safeSegment(selectedDoi.replace(/\//g, "_"), "UnknownDOI");
    const base = `${year} - ${author} - ${shortTitle} - ${normalizedDoi}`;
    return `${truncate(base, MAX_FILENAME_LENGTH)}.pdf`;
  }, [metadata, selectedDoi]);

  const lookupDoi = async (doi: string) => {
    setSelectedDoi(doi);
    setMetadata(null);
    setLoading(true);
    setStatus("正在查詢 Crossref...");

    try {
      const work = await fetchCrossref(doi);
      setMetadata(work);
      setStatus("已取得 metadata，可下載新檔名 PDF。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "查詢 Crossref 失敗");
    } finally {
      setLoading(false);
    }
  };

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPdfFile(file);
    setMetadata(null);
    setAllDois([]);
    setSelectedDoi("");
    setManualDoi("");
    setLoading(true);
    setStatus("正在解析 PDF 文字...");

    try {
      const text = await extractTextFromPdf(file);
      const dois = findDois(text);
      setAllDois(dois);

      if (dois.length === 0) {
        setStatus("找不到 DOI，請手動輸入。\n(找不到 DOI)");
        return;
      }

      await lookupDoi(dois[0]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "處理 PDF 時發生錯誤");
      setLoading(false);
    }
  };

  const onManualLookup = async () => {
    const doi = cleanDoi(manualDoi);
    if (!doi) {
      setStatus("請先輸入有效 DOI。");
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
      <h1>Paper PDF Renamer</h1>
      <p className="subtitle">上傳 PDF → 偵測 DOI → 查 Crossref → 下載新檔名</p>

      <label className="uploadButton" htmlFor="pdfUpload" aria-disabled={loading}>
        上傳 PDF
      </label>
      <input id="pdfUpload" type="file" accept="application/pdf" onChange={onUpload} disabled={loading} />

      {allDois.length > 1 && (
        <div className="field">
          <label htmlFor="doiSelect">偵測到多個 DOI：</label>
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
          placeholder="手動輸入 DOI"
          value={manualDoi}
          onChange={(event) => setManualDoi(event.target.value)}
          disabled={loading}
        />
        <button type="button" onClick={() => void onManualLookup()} disabled={loading}>
          用手動 DOI 查詢
        </button>
      </div>

      {metadata && (
        <section className="metadata">
          <h2>Metadata</h2>
          <ul>
            <li>
              <strong>Title:</strong> {metadata.title?.[0] ?? "N/A"}
            </li>
            <li>
              <strong>Author:</strong> {metadata.author?.map((a) => a.family ?? a.name).join(", ") ?? "N/A"}
            </li>
            <li>
              <strong>Year:</strong> {getYear(metadata)}
            </li>
            <li>
              <strong>Journal:</strong> {metadata["container-title"]?.[0] ?? "N/A"}
            </li>
            <li>
              <strong>DOI:</strong> {selectedDoi}
            </li>
          </ul>
        </section>
      )}

      <p className="status">{status}</p>

      <button type="button" onClick={() => void onDownload()} disabled={!filename || loading}>
        Download
      </button>

      {filename && <p className="filename">新檔名：{filename}</p>}
    </main>
  );
}
