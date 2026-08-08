import React, { useState } from 'react';
import { AlertCircleIcon, XIcon } from './Icons';

interface ParsedError {
  title: string;
  message: string;
  raw?: string;
}

/**
 * Turns a raw error string (which may be a bare message, or a provider error
 * that embeds a raw JSON/HTTP body, e.g. `Claude error: 529 - {"type":"error",...}`)
 * into a short, human-readable title + message. The original raw text stays
 * available behind "Show technical details" so nothing is lost, it's just not
 * dumped on screen by default. Pure display formatting only.
 */
function parseErrorMessage(input: string): ParsedError {
  const text = (input || '').trim();

  // Try to find an embedded JSON object anywhere in the string
  const jsonStart = text.indexOf('{');
  let jsonPayload: any = null;
  if (jsonStart !== -1) {
    const candidate = text.slice(jsonStart);
    try {
      jsonPayload = JSON.parse(candidate);
    } catch {
      // Not parseable JSON (or trailing text) — fall through to plain text handling
    }
  }

  // HTTP status code, if present anywhere in the string (e.g. "529", "status 429")
  const statusMatch = text.match(/\b(4\d{2}|5\d{2})\b/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : null;

  const nestedMessage: string | undefined =
    jsonPayload?.error?.message ||
    jsonPayload?.message ||
    (typeof jsonPayload?.error === 'string' ? jsonPayload.error : undefined);

  if (status === 529 || /overloaded/i.test(text)) {
    return {
      title: 'Provider is temporarily overloaded',
      message: 'The AI provider is receiving too much traffic right now. Wait a few seconds and try again — this is not caused by anything in your data.',
      raw: text
    };
  }
  if (status === 429 || /rate limit/i.test(text)) {
    return {
      title: 'Rate limit reached',
      message: 'You have hit the provider\'s request rate limit. Wait a moment before retrying, or reduce bulk evaluation concurrency.',
      raw: text
    };
  }
  if (status === 401 || status === 403 || /invalid.*api.?key|unauthorized/i.test(text)) {
    return {
      title: 'API key rejected',
      message: 'The provider rejected your API key. Double-check it in Settings → Model & API Keys, and confirm it has not expired.',
      raw: text
    };
  }
  if (/api key is missing/i.test(text)) {
    return {
      title: 'API key missing',
      message: text,
      raw: undefined
    };
  }
  if (status && status >= 500) {
    return {
      title: `Provider error (${status})`,
      message: nestedMessage || 'The AI provider had an internal error. This usually resolves itself — try again in a moment.',
      raw: text
    };
  }
  if (status && status >= 400) {
    return {
      title: `Request failed (${status})`,
      message: nestedMessage || 'The provider rejected this request. Check your model name and configuration in Settings.',
      raw: text
    };
  }

  // No JSON / status detected — if the message looks like raw JSON/object dump, keep it collapsed too
  if (jsonPayload) {
    return {
      title: 'Something went wrong',
      message: nestedMessage || 'An unexpected error occurred while contacting the AI provider.',
      raw: text
    };
  }

  // Plain, already-human-readable message — show as-is, no raw details needed
  return { title: 'Something went wrong', message: text || 'An unknown error occurred.' };
}

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onDismiss }) => {
  const [showDetails, setShowDetails] = useState(false);
  const parsed = parseErrorMessage(message);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-6 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 rounded-xl shadow-sm animate-in fade-in slide-in-from-top-1 duration-200"
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <AlertCircleIcon size={18} className="flex-shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-snug">{parsed.title}</p>
          <p className="text-sm leading-relaxed mt-0.5 text-red-700 dark:text-red-300">{parsed.message}</p>
          {parsed.raw && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowDetails(v => !v)}
                className="text-xs font-semibold text-red-600 dark:text-red-300 hover:underline cursor-pointer"
                aria-expanded={showDetails}
              >
                {showDetails ? 'Hide technical details' : 'Show technical details'}
              </button>
              {showDetails && (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-red-100/70 dark:bg-red-950/60 border border-red-200 dark:border-red-900 p-2.5 text-[11px] font-mono text-red-900 dark:text-red-200">
                  {parsed.raw}
                </pre>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="flex-shrink-0 p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/50 dark:hover:text-red-200 transition-colors cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
        >
          <XIcon size={14} />
        </button>
      </div>
    </div>
  );
};
