import { ChangeEvent, DragEvent, useMemo, useState } from 'react';

type Step = 'idle' | 'uploading' | 'renaming' | 'done' | 'error';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function extractFilename(header: string | null): string {
  if (!header) return 'renamed.pdf';
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? 'renamed.pdf';
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Step>('idle');
  const [toast, setToast] = useState<string>('');

  const stepLabels = useMemo(
    () => [
      { key: 'uploading', label: 'Upload PDF' },
      { key: 'renaming', label: 'Extract DOI + Fetch Metadata' },
      { key: 'done', label: 'Download Renamed PDF' }
    ],
    []
  );

  const showError = (message: string) => {
    setStatus('error');
    setToast(message);
    window.setTimeout(() => setToast(''), 4000);
  };

  const validateFile = (file: File): boolean => {
    if (file.type !== 'application/pdf') {
      showError('Only PDF files are supported.');
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      showError('File exceeds 20MB limit.');
      return false;
    }
    return true;
  };

  const onFilePicked = (file: File | null) => {
    if (!file) return;
    if (!validateFile(file)) return;
    setSelectedFile(file);
    setStatus('idle');
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFilePicked(event.target.files?.[0] ?? null);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    onFilePicked(event.dataTransfer.files?.[0] ?? null);
  };

  const renamePdf = async () => {
    if (!selectedFile) {
      showError('Choose a PDF first.');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    setStatus('uploading');
    try {
      const response = await fetch('/api/rename', { method: 'POST', body: formData });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Rename request failed.');
      }

      setStatus('renaming');
      const blob = await response.blob();
      const filename = extractFilename(response.headers.get('content-disposition'));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus('done');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-6">
        <header className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">PDF DOI Renamer</h1>
          <p className="mt-3 text-slate-300">
            Upload a paper PDF and get a clean, metadata-based filename using DOI extraction.
          </p>
        </header>

        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`w-full cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition ${
            dragging ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-600 bg-slate-800/30'
          }`}
        >
          <input type="file" accept="application/pdf" className="hidden" onChange={onInputChange} />
          <p className="text-lg font-semibold">Drag and drop your PDF here</p>
          <p className="mt-2 text-sm text-slate-400">or click to browse · max 20MB</p>
          {selectedFile ? <p className="mt-4 text-cyan-300">Selected: {selectedFile.name}</p> : null}
        </label>

        <div className="w-full rounded-2xl bg-slate-800/60 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">Progress</h2>
          <ol className="space-y-3">
            {stepLabels.map((step, index) => {
              const active =
                (status === 'uploading' && index === 0) ||
                (status === 'renaming' && index <= 1) ||
                (status === 'done' && index <= 2);
              return (
                <li key={step.key} className="flex items-center gap-3">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      active ? 'bg-cyan-400 text-slate-900' : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className={active ? 'text-cyan-200' : 'text-slate-300'}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <button
          type="button"
          onClick={renamePdf}
          className="rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!selectedFile || status === 'uploading' || status === 'renaming'}
        >
          {status === 'uploading' || status === 'renaming' ? 'Processing...' : 'Rename PDF'}
        </button>

        {toast ? (
          <div className="fixed bottom-8 right-8 rounded-lg border border-red-400 bg-red-500/90 px-4 py-3 text-sm font-medium text-white shadow-lg">
            {toast}
          </div>
        ) : null}
      </div>
    </main>
  );
}
