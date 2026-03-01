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

type JobStatus =
  | "queued"
  | "extracting"
  | "detecting"
  | "fetching"
  | "ready"
  | "failed";

type PdfJob = {
  id: string;
  file: File;
  status: JobStatus;
  dois: string[];
  selectedDoi?: string;
  manualDoi?: string;
  metadata?: CrossrefWork;
  error?: string;
  resolvedFilename?: string;
};

const TEXT = {
  en: {
    title: "Paper PDF Renamer",
    subtitle: "Upload PDF → Detect DOI → Fetch Metadata → Download Renamed File",
    upload: "Upload PDF",
    dropHere: "Drag & drop PDF files here, or click to select",
    processAll: "Process All",
    downloadAll: "Download All",
    clear: "Clear",
    fileName: "File name",
    status: "Status",
    doi: "DOI",
    resolvedFilename: "Resolved filename",
    actions: "Actions",
    process: "Process",
    retry: "Fetch/Retry",
    download: "Download",
    remove: "Remove",
    noJobs: "No files added yet.",
    manualPlaceholder: "Enter DOI manually",
    invalidDoi: "Invalid DOI",
    noDoiFound: "No DOI found",
    statusQueued: "Queued",
    statusExtracting: "Extracting",
    statusDetecting: "Detecting",
    statusFetching: "Fetching",
    statusReady: "Ready",
    statusFailed: "Failed",
  },
  zh: {
    title: "Paper PDF Renamer",
    subtitle: "上傳 PDF → 偵測 DOI → 查 Crossref → 下載新檔名",
    upload: "上傳 PDF",
    dropHere: "拖拉 PDF 到這裡，或點擊選擇檔案",
    processAll: "全部處理",
    downloadAll: "全部下載",
    clear: "清除",
    fileName: "檔名",
    status: "狀態",
    doi: "DOI",
    resolvedFilename: "最終檔名",
    actions: "操作",
    process: "處理",
    retry: "重試",
    download: "下載",
    remove: "移除",
    noJobs: "尚未加入檔案。",
    manualPlaceholder: "手動輸入 DOI",
    invalidDoi: "無效 DOI",
    noDoiFound: "找不到 DOI",
    statusQueued: "排隊中",
    statusExtracting: "擷取中",
    statusDetecting: "偵測中",
    statusFetching: "查詢中",
    statusReady: "完成",
    statusFailed: "失敗",
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
  const [jobs, setJobs] = useState<PdfJob[]>([]);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const t = TEXT[lang];

  const lookupDoi = async (doi: string) => fetchCrossref(doi);

  const getFallbackName = (fileName: string): string => {
    const base = fileName.toLowerCase().endsWith(".pdf") ? fileName.slice(0, -4) : fileName;
    const safeBase = safeSegment(base, "untitled");
    return `${safeBase}.pdf`;
  };

  const withCollisionSuffix = (name: string, used: Set<string>): string => {
    const dot = name.toLowerCase().endsWith(".pdf") ? name.length - 4 : -1;
    const base = dot >= 0 ? name.slice(0, dot) : name;
    const ext = dot >= 0 ? name.slice(dot) : ".pdf";

    let candidate = `${base}${ext}`;
    let index = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} (${index})${ext}`;
      index += 1;
    }

    used.add(candidate.toLowerCase());
    return candidate;
  };

  const computeCandidateName = (job: PdfJob): string => {
    if (job.status === "ready" && job.metadata) {
      const year = safeSegment(getYear(job.metadata), "UnknownYear");
      const author = safeSegment(getFirstAuthor(job.metadata), "UnknownAuthor");
      const shortTitle = safeSegment(getShortTitle(job.metadata), "Untitled");
      const journalAbbr = safeSegment(getJournalAbbr(job.metadata), "UnknownJournal");
      const base = `${year} - ${author} - ${shortTitle} - ${journalAbbr}`;
      return `${truncate(base, MAX_FILENAME_LENGTH)}.pdf`;
    }

    return getFallbackName(job.file.name);
  };

  const resolveAllFilenames = (nextJobs: PdfJob[]): PdfJob[] => {
    const used = new Set<string>();

    return nextJobs.map((job) => {
      const candidate = computeCandidateName(job);
      const resolvedFilename = withCollisionSuffix(candidate, used);
      return { ...job, resolvedFilename };
    });
  };

  function updateJobs(mutator: (prev: PdfJob[]) => PdfJob[]) {
    setJobs((prev) => resolveAllFilenames(mutator(prev)));
  }

  const getJob = (jobId: string): PdfJob | undefined => jobs.find((job) => job.id === jobId);

  const processJob = async (jobId: string) => {
    const start = getJob(jobId);
    if (!start) return;
    const file = start.file;

    updateJobs((prev) =>
      prev.map((job) =>
        job.id === jobId
          ? { ...job, status: "extracting", error: undefined, metadata: undefined }
          : job,
      ),
    );

    try {
      const text = await extractTextFromPdf(file);

      updateJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status: "detecting" } : job)));

      const detected = findDois(text);

      let doiToLookup = "";
      let manualHasInput = false;
      let manualInvalid = false;

      updateJobs((prev) =>
        prev.map((job) => {
          if (job.id !== jobId) return job;

          const manualTrim = (job.manualDoi ?? "").trim();
          manualHasInput = manualTrim.length > 0;
          const selected =
            job.selectedDoi && job.selectedDoi.trim().length > 0
              ? job.selectedDoi
              : (detected[0] ?? "");

          doiToLookup = manualTrim ? cleanDoi(manualTrim) : selected;
          manualInvalid = manualHasInput && doiToLookup.trim().length === 0;

          return {
            ...job,
            dois: detected,
            selectedDoi: selected,
          };
        }),
      );

      if (detected.length === 0) {
        updateJobs((prev) =>
          prev.map((job) =>
            job.id === jobId ? { ...job, status: "failed", error: "No DOI found", metadata: undefined } : job,
          ),
        );
        return;
      }

      if (!doiToLookup || doiToLookup.trim().length === 0) {
        updateJobs((prev) =>
          prev.map((job) => (job.id === jobId ? { ...job, status: "failed", error: "No DOI found" } : job)),
        );
        return;
      }

      if (manualInvalid) {
        updateJobs((prev) =>
          prev.map((job) => (job.id === jobId ? { ...job, status: "failed", error: "Invalid DOI" } : job)),
        );
        return;
      }

      updateJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status: "fetching" } : job)));

      try {
        const work = await lookupDoi(doiToLookup);
        updateJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  metadata: work,
                  selectedDoi: doiToLookup,
                  status: "ready",
                  error: undefined,
                }
              : job,
          ),
        );
      } catch (error) {
        updateJobs((prev) =>
          prev.map((job) =>
            job.id === jobId
              ? {
                  ...job,
                  status: "failed",
                  error: error instanceof Error ? error.message : "Crossref lookup failed",
                  metadata: undefined,
                }
              : job,
          ),
        );
      }
    } catch {
      updateJobs((prev) =>
        prev.map((job) => (job.id === jobId ? { ...job, status: "failed", error: "Error processing PDF" } : job)),
      );
    }
  };

  const processAll = async () => {
    const ids = jobs.map((j) => j.id);
    for (const id of ids) {
      await processJob(id);
    }
  };

  const downloadJob = async (job: PdfJob) => {
    const buf = await job.file.arrayBuffer();
    const blob = new Blob([buf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = job.resolvedFilename ?? getFallbackName(job.file.name);
    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), 100);
    anchor.remove();
  };

  const downloadAll = async () => {
    for (const job of jobs) {
      await downloadJob(job);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  const appendFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const items = Array.from(files).filter(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );

    if (items.length === 0) return;

    updateJobs((prev) => [
      ...prev,
      ...items.map((file) => ({
        id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: "queued" as const,
        dois: [],
      })),
    ]);
  };

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    appendFiles(event.target.files);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    appendFiles(event.dataTransfer.files);
  };

  const allProcessed = useMemo(
    () => jobs.length > 0 && jobs.every((job) => job.status === "ready" || job.status === "failed"),
    [jobs],
  );

  const statusLabel = (status: JobStatus) => {
    switch (status) {
      case "queued":
        return t.statusQueued;
      case "extracting":
        return t.statusExtracting;
      case "detecting":
        return t.statusDetecting;
      case "fetching":
        return t.statusFetching;
      case "ready":
        return t.statusReady;
      case "failed":
        return t.statusFailed;
      default:
        return status;
    }
  };

  return (
    <main className="container">
      <div className="langToggle">
        <button type="button" onClick={() => setLang("en")} disabled={lang === "en"}>
          EN
        </button>
        <button type="button" onClick={() => setLang("zh")} disabled={lang === "zh"}>
          中文
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
        onDrop={onDrop}
      >
        <p>{t.dropHere}</p>
        <label className="uploadButton" htmlFor="pdfUpload">
          {t.upload}
        </label>
        <input id="pdfUpload" type="file" accept="application/pdf" multiple onChange={onUpload} />
      </div>

      <div className="field inline" style={{ marginBottom: 16 }}>
        <button type="button" onClick={() => void processAll()} disabled={jobs.length === 0}>
          {t.processAll}
        </button>
        <button type="button" onClick={() => void downloadAll()} disabled={!allProcessed}>
          {t.downloadAll}
        </button>
        <button type="button" onClick={() => updateJobs(() => [])} disabled={jobs.length === 0}>
          {t.clear}
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="status">{t.noJobs}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" }}>{t.fileName}</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" }}>{t.status}</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" }}>{t.doi}</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" }}>{t.resolvedFilename}</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" }}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td style={{ verticalAlign: "top", padding: "8px 6px" }}>{job.file.name}</td>
                  <td style={{ verticalAlign: "top", padding: "8px 6px" }}>
                    {statusLabel(job.status)}
                    {job.error ? <div style={{ color: "#b42318" }}>{job.error}</div> : null}
                  </td>
                  <td style={{ verticalAlign: "top", padding: "8px 6px", minWidth: 220 }}>
                    {job.dois.length > 0 ? (
                      <select
                        value={job.selectedDoi ?? job.dois[0]}
                        onChange={(event) =>
                          updateJobs((prev) =>
                            prev.map((item) =>
                              item.id === job.id ? { ...item, selectedDoi: event.target.value } : item,
                            ),
                          )
                        }
                      >
                        {job.dois.map((doi) => (
                          <option key={doi} value={doi}>
                            {doi}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <input
                      type="text"
                      placeholder={t.manualPlaceholder}
                      value={job.manualDoi ?? ""}
                      onChange={(event) =>
                        updateJobs((prev) =>
                          prev.map((item) =>
                            item.id === job.id ? { ...item, manualDoi: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </td>
                  <td style={{ verticalAlign: "top", padding: "8px 6px" }}>{job.resolvedFilename}</td>
                  <td style={{ verticalAlign: "top", padding: "8px 6px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <button type="button" onClick={() => void processJob(job.id)} disabled={job.status !== "queued"}>
                        {t.process}
                      </button>
                      <button type="button" onClick={() => void processJob(job.id)} disabled={job.status !== "failed"}>
                        {t.retry}
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadJob(job)}
                        disabled={job.status !== "ready" && job.status !== "failed"}
                      >
                        {t.download}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateJobs((prev) => prev.filter((item) => item.id !== job.id))
                        }
                      >
                        {t.remove}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
