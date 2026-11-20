import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  StudyPlan,
  StudyWindowConfig,
  SyncMode,
  UploadedFilePayload,
  UserAccount,
} from '../types/study';
import {
  addCalendarDays,
  calculateSpacedSchedule,
  formatLocalDate,
} from '../utils/spacingEngine';
import { generateAndSaveStudyPlan } from '../services/apiClient';

interface CreatePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserAccount | null;
  onPlanCreated: (
    plan: StudyPlan,
    autoSyncMode: SyncMode,
    persistedInMySql: boolean
  ) => void;
}

const StepBadge: React.FC<{ num: number }> = ({ num }) => (
  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 text-xs font-extrabold text-white shadow-xs">
    {num}
  </span>
);

function snapToFiveMinuteStep(timeValue: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue.trim());
  if (!match) return timeValue;
  let hours = Number(match[1]);
  let mins = Math.round(Number(match[2]) / 5) * 5;
  if (mins >= 60) {
    mins = 0;
    hours = Math.min(23, hours + 1);
  }
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export const CreatePlanModal: React.FC<CreatePlanModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onPlanCreated,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  const todayStr = useMemo(() => formatLocalDate(new Date()), []);
  const defaultMasterBy = useMemo(
    () => addCalendarDays(todayStr, 14),
    [todayStr]
  );

  const [topicPrompt, setTopicPrompt] = useState('');
  const [startDate, setStartDate] = useState(todayStr);
  const [masterByDate, setMasterByDate] = useState(defaultMasterBy);
  const [startHour, setStartHour] = useState('09:00');
  const [endHour, setEndHour] = useState('17:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [syncMode, setSyncMode] = useState<SyncMode>('google_calendar');

  const [urlInput, setUrlInput] = useState('');
  const [urls, setUrls] = useState<string[]>([]);
  const [files, setFiles] = useState<UploadedFilePayload[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Open/close native <dialog> via showModal() + modern-web-guidance light-dismiss fallback
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      if (isOpen) {
        onClose();
      }
    };

    dialog.addEventListener('close', handleClose);

    // Fallback for browsers that do not yet support declarative `closedby="any"`
    let cleanupFallback: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pointerStartedOnBackdrop = false;
      const isBackdropEvent = (event: PointerEvent) => {
        if (event.target !== dialog) return false;
        const rect = dialog.getBoundingClientRect();
        return !(
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
      };
      const handlePointerDown = (event: PointerEvent) => {
        pointerStartedOnBackdrop = isBackdropEvent(event);
      };
      const handlePointerUp = (event: PointerEvent) => {
        if (pointerStartedOnBackdrop && isBackdropEvent(event)) {
          dialog.close();
        }
        pointerStartedOnBackdrop = false;
      };
      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('pointerup', handlePointerUp);
      cleanupFallback = () => {
        dialog.removeEventListener('pointerdown', handlePointerDown);
        dialog.removeEventListener('pointerup', handlePointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      if (cleanupFallback) cleanupFallback();
    };
  }, [isOpen, onClose]);

  const spacingPreview = useMemo(
    () => calculateSpacedSchedule(startDate, masterByDate),
    [startDate, masterByDate]
  );

  const handleAddUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    const normalized = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    if (!urls.includes(normalized)) {
      setUrls((prev) => [...prev, normalized]);
    }
    setUrlInput('');
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMessage(null);

    const newPayloads: UploadedFilePayload[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > 25 * 1024 * 1024) {
        setErrorMessage(`File "${file.name}" exceeds 25 MB limit.`);
        continue;
      }

      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      newPayloads.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        name: file.name,
        size: file.size,
        mimeType: file.type || inferMimeType(file.name),
        base64Data,
      });
    }

    setFiles((prev) => [...prev, ...newPayloads]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!topicPrompt.trim() && files.length === 0 && urls.length === 0) {
      setErrorMessage(
        'Provide a study topic/focus prompt, upload a study file, or add at least one URL.'
      );
      return;
    }

    if (masterByDate <= startDate && spacingPreview.totalDays < 1) {
      setErrorMessage('Master By Date must be at least 1 day after Start Date.');
      return;
    }

    setIsGenerating(true);
    try {
      const normalizedStartHour = snapToFiveMinuteStep(startHour);
      const normalizedEndHour = snapToFiveMinuteStep(endHour);
      const studyWindow: StudyWindowConfig = {
        startHour: normalizedStartHour,
        endHour: normalizedEndHour,
        durationMinutes,
        syncMode,
      };

      const { plan, persistedInMySql } = await generateAndSaveStudyPlan({
        topicPrompt,
        urls,
        files,
        startDate,
        masterByDate,
        scheduledBlueprints: spacingPreview.sessions,
        studyWindow,
        user: currentUser,
      });

      onPlanCreated(plan, syncMode, persistedInMySql);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to generate study plan.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
      className="m-auto w-full max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 shadow-2xl open:flex open:flex-col max-h-[92vh]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4 bg-white/95 dark:bg-slate-900/95 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img
            src="/study/logo.png"
            alt="Practice Buddy"
            className="h-9 w-9 rounded-xl object-contain shrink-0"
          />
          <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-white">
            Create a Study Plan
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Form Body */}
      <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6">
        {/* 1. Topic / Focus Prompt */}
        <div>
          <label
            htmlFor="topic-prompt-input"
            className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-white mb-2"
          >
            <StepBadge num={1} />
            <span>Study Topic, Exam Objectives, or Focus Prompt</span>
          </label>
          <textarea
            id="topic-prompt-input"
            autoFocus
            {...({ autofocus: '' } as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={3}
            value={topicPrompt}
            onChange={(e) => setTopicPrompt(e.target.value)}
            placeholder="Describe what you need to master (e.g., 'Constitutional Law: Dormant Commerce Clause & Federal Preemption', or paste syllabus objectives)..."
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/80 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        {/* 2. Multimodal File Dropzone & URL Harvester */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* File Dropzone */}
          <div className="flex flex-col">
            <span className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-white mb-2">
              <StepBadge num={2} />
              <span>Multimodal Study Files (PDF, DOCX, TXT, MD, CSV, Slides)</span>
            </span>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                void handleFilesSelected(e.dataTransfer.files);
              }}
              className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition ${
                isDragging
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 hover:border-emerald-500/60 dark:hover:border-slate-600'
              }`}
            >
              <Upload className="h-6 w-6 text-emerald-600 dark:text-emerald-400 mb-2" />
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                Drag &amp; drop files here, or{' '}
                <span className="text-emerald-600 dark:text-emerald-400 underline">
                  browse
                </span>
              </span>
              <span className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Supports .pdf, .docx, .txt, .md, .csv, .png, .jpg (inlineData Base64)
              </span>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
                onChange={(e) => void handleFilesSelected(e.target.files)}
                className="sr-only"
              />
            </label>

            {files.length > 0 && (
              <ul className="mt-2.5 space-y-1.5 max-h-32 overflow-y-auto">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      {f.mimeType.startsWith('image/') ? (
                        <ImageIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                      )}
                      <span className="truncate text-slate-800 dark:text-slate-200">
                        {f.name}
                      </span>
                      <span className="text-slate-500 shrink-0">
                        ({Math.max(1, Math.round(f.size / 1024))} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFiles((prev) => prev.filter((item) => item.id !== f.id))
                      }
                      className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 ml-2"
                      aria-label={`Remove ${f.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* URL / Link Harvester */}
          <div className="flex flex-col">
            <label
              htmlFor="url-harvester-input"
              className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-white mb-2"
            >
              <StepBadge num={3} />
              <span>URL / Link Harvester (Articles, Docs, YouTube)</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <input
                  id="url-harvester-input"
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddUrl();
                    }
                  }}
                  placeholder="https://docs.google.com/... or article URL"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/80 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleAddUrl}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>

            {urls.length > 0 && (
              <ul className="mt-2.5 space-y-1.5 max-h-32 overflow-y-auto">
                {urls.map((u) => (
                  <li
                    key={u}
                    className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs"
                  >
                    <span className="truncate text-sky-700 dark:text-sky-300">
                      {u}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setUrls((prev) => prev.filter((item) => item !== u))
                      }
                      className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 ml-2"
                      aria-label={`Remove ${u}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 4. Timeline & Evidence-Based Spacing Preview */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
              <StepBadge num={4} />
              <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Timeline</span>
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="start-date-input"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Start Date (Day 0)
              </label>
              <input
                id="start-date-input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="master-by-date-input"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Master By Date (Day T)
              </label>
              <input
                id="master-by-date-input"
                type="date"
                value={masterByDate}
                min={addCalendarDays(startDate, 1)}
                onChange={(e) => setMasterByDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Dynamic Horizon Status Badge directly underneath date selectors */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
              {spacingPreview.horizonLabel} • {spacingPreview.sessions.length} Sessions
            </span>
          </div>

          {/* Compressed Horizon Warning Badge when T <= 3 */}
          {spacingPreview.isCompressedWarning && spacingPreview.warningMessage && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-amber-800 dark:text-amber-300">
                  Ultra-Short Horizon Warning (T ≤ 3 Days):{' '}
                </span>
                {spacingPreview.warningMessage}
              </div>
            </div>
          )}

          {/* Live Cepeda Interval Preview Chips */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-2">
              <span>Computed Cepeda et al. (2008) Retrieval Intervals:</span>
              <span className="font-mono text-sky-700 dark:text-sky-300">
                {spacingPreview.cepedaOptimalIsiRatio}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              {spacingPreview.sessions.map((s) => (
                <div
                  key={s.sessionNumber}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-2 text-xs"
                >
                  <div className="flex items-center justify-between font-mono text-[11px] text-sky-700 dark:text-sky-400">
                    <span>
                      #{s.sessionNumber} • Day {s.dayOffset}
                    </span>
                    {s.gapDays > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{s.gapDays}d
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-medium text-slate-800 dark:text-slate-200 truncate">
                    {s.scheduledDate}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {s.stageName.replace(/^Stage \d+:\s*/, '')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 5. Preferred Study Window */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <StepBadge num={5} />
            <Clock className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <span>Preferred Study Window</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="study-window-start"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Preferred Window (FreeBusy)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="study-window-start"
                  type="time"
                  step={300}
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                  onBlur={(e) => setStartHour(snapToFiveMinuteStep(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs text-slate-900 dark:text-white focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none"
                />
                <span className="text-slate-500 text-xs">–</span>
                <input
                  type="time"
                  step={300}
                  aria-label="Study window end time"
                  value={endHour}
                  onChange={(e) => setEndHour(e.target.value)}
                  onBlur={(e) => setEndHour(snapToFiveMinuteStep(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs text-slate-900 dark:text-white focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                5-minute increments (:00, :05, ..., :55)
              </p>
            </div>

            <div>
              <label
                htmlFor="block-duration-select"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Session Block Length
              </label>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <select
                  id="block-duration-select"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-white"
                >
                  <option value={25}>25 mins (Pomodoro)</option>
                  <option value={30}>30 mins (Recommended)</option>
                  <option value={45}>45 mins (Deep Practice)</option>
                  <option value={60}>60 mins (Full Mastery)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 6. Sync Mode Selection */}
        <div>
          <span className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-white mb-2.5">
            <StepBadge num={6} />
            <span>Calendar &amp; Tasks Deep-Link Sync Mode</span>
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: 'google_calendar' as SyncMode,
                title: 'Timed Google Calendar Blocks',
                desc: 'Checks FreeBusy API & books open 30-min slots with quiz deep link',
              },
              {
                id: 'google_tasks' as SyncMode,
                title: 'Google Tasks Reminders',
                desc: 'Creates due-dated Google Tasks with embedded recall prompts & deep link',
              },
              {
                id: 'ics_download' as SyncMode,
                title: 'Universal .ics Download',
                desc: 'Downloads RFC-5545 calendar file for Apple, Outlook, or Google Calendar',
              },
            ].map((option) => {
              const selected = syncMode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSyncMode(option.id)}
                  className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                    selected
                      ? 'border-emerald-600 dark:border-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/15 text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-semibold">{option.title}</span>
                    {selected && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <span className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {option.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-200">
            {errorMessage}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isGenerating}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 disabled:opacity-60 transition"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Synthesizing Spaced Plan via Gemini 3.8 Flash...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Create My Study Plan
              </>
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
};

function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'text/plain';
}
