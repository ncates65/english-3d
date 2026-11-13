import {
  StudyPlan,
  StudySession,
  StudyWindowConfig,
} from '../types/study';
import { parseLocalDate } from './spacingEngine';

export const PRODUCTION_STUDY_URL = 'https://english-3D.com/study';

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

/**
 * Construct the canonical deep link back to the interactive Active-Recall Quiz & Feynman Studio.
 */
export function buildSessionDeepLink(planId: number, sessionId: number): string {
  return `${PRODUCTION_STUDY_URL}/?plan_id=${encodeURIComponent(planId)}&session_id=${encodeURIComponent(sessionId)}`;
}

/**
 * Build the rich description / note body embedded in every Google Calendar event,
 * Google Task note, and .ics calendar entry.
 */
export function buildSessionSyncDescription(
  plan: StudyPlan,
  session: StudySession
): string {
  const deepLink = buildSessionDeepLink(plan.id, session.id);
  const sourceUrls =
    plan.sourceLinks && plan.sourceLinks.length > 0
      ? plan.sourceLinks.map((s) => `• ${s.title || s.url}: ${s.url}`).join('\n')
      : '• Uploaded Multimodal Study Files / Topic Notes (Cached in Practice Buddy)';

  const promptsList =
    session.prompts && session.prompts.length > 0
      ? session.prompts.map((p, idx) => `${idx + 1}. ${p}`).join('\n')
      : '1. Complete closed-book free recall of core concepts.';

  const checklist =
    session.verificationChecklist && session.verificationChecklist.length > 0
      ? session.verificationChecklist.map((c) => `[ ] ${c}`).join('\n')
      : '';

  return [
    `🚀 LAUNCH INTERACTIVE AI-GRADED QUIZ & FEYNMAN STUDIO:`,
    deepLink,
    ``,
    `📘 Study Plan: ${plan.topicTitle}`,
    `🧠 Stage (${session.stageName}) — Day ${session.dayOffset} (Gap: +${session.gapDays}d)`,
    `🎯 Cognitive Goal: ${session.cognitiveGoal}`,
    ``,
    `🔒 CLOSED-BOOK ACTIVE-RECALL PROMPTS (Answer before checking notes):`,
    promptsList,
    checklist ? `\n✅ MASTERY VERIFICATION RUBRIC:\n${checklist}` : '',
    ``,
    `🔗 ORIGINAL SOURCE MATERIAL URL(S):`,
    sourceUrls,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Request an OAuth2 Access Token via Google Identity Services (GIS).
 */
export function requestGoogleOAuthToken(
  clientId: string,
  scopes: string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(
        new Error(
          'Google Identity Services script is still loading or blocked by an ad-blocker.'
        )
      );
      return;
    }

    if (!clientId || clientId.startsWith('REPLACE_WITH_')) {
      reject(
        new Error(
          'Google OAuth Client ID is not configured yet. Enter your Client ID in the Sync settings or api/config.php.'
        )
      );
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(' '),
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                'OAuth authorization was cancelled.'
            )
          );
          return;
        }
        resolve(response.access_token);
      },
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

/**
 * Query Google Calendar FreeBusy API (`https://www.googleapis.com/calendar/v3/freeBusy`)
 * for a given date's preferred study window and return the first conflict-free slot.
 */
export async function findOpenSlotViaFreeBusy(
  accessToken: string,
  scheduledDate: string,
  windowConfig: StudyWindowConfig
): Promise<{ startIso: string; endIso: string; conflictResolved: boolean }> {
  const [startH, startM] = (windowConfig.startHour || '09:00')
    .split(':')
    .map(Number);
  const [endH, endM] = (windowConfig.endHour || '17:00')
    .split(':')
    .map(Number);
  const durationMs = (windowConfig.durationMinutes || 30) * 60 * 1000;

  const baseDay = parseLocalDate(scheduledDate);
  const windowStart = new Date(baseDay);
  windowStart.setHours(startH || 9, startM || 0, 0, 0);

  const windowEnd = new Date(baseDay);
  windowEnd.setHours(endH || 17, endM || 0, 0, 0);

  if (windowEnd.getTime() <= windowStart.getTime() + durationMs) {
    windowEnd.setTime(windowStart.getTime() + Math.max(durationMs * 2, 3600000));
  }

  try {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          items: [{ id: 'primary' }],
        }),
      }
    );

    if (!response.ok) {
      return {
        startIso: windowStart.toISOString(),
        endIso: new Date(windowStart.getTime() + durationMs).toISOString(),
        conflictResolved: false,
      };
    }

    const data = await response.json();
    const busyBlocks: Array<{ start: string; end: string }> =
      data?.calendars?.primary?.busy || [];

    const busyIntervals = busyBlocks
      .map((b) => ({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
      }))
      .sort((a, b) => a.start - b.start);

    // Step in 15-minute increments inside the preferred study window to find an open block
    let candidateStart = windowStart.getTime();
    let shiftedDueToConflict = false;
    const stepMs = 15 * 60 * 1000;

    while (candidateStart + durationMs <= windowEnd.getTime()) {
      const candidateEnd = candidateStart + durationMs;
      const hasOverlap = busyIntervals.some(
        (busy) => candidateStart < busy.end && candidateEnd > busy.start
      );

      if (!hasOverlap) {
        return {
          startIso: new Date(candidateStart).toISOString(),
          endIso: new Date(candidateEnd).toISOString(),
          conflictResolved: shiftedDueToConflict,
        };
      }

      shiftedDueToConflict = true;
      candidateStart += stepMs;
    }
  } catch {
    // Fallback to start of preferred window if FreeBusy check fails
  }

  return {
    startIso: windowStart.toISOString(),
    endIso: new Date(windowStart.getTime() + durationMs).toISOString(),
    conflictResolved: false,
  };
}

/**
 * Method 1A: Batch Sync Sessions to Google Calendar with FreeBusy Conflict Avoidance.
 */
export async function syncPlanToGoogleCalendar(
  plan: StudyPlan,
  windowConfig: StudyWindowConfig,
  clientId: string
): Promise<{
  syncedCount: number;
  conflictsAvoided: number;
  mappings: Array<{ sessionId: number; calendarEventId: string; htmlLink?: string }>;
}> {
  const accessToken = await requestGoogleOAuthToken(clientId, [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ]);

  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  const mappings: Array<{
    sessionId: number;
    calendarEventId: string;
    htmlLink?: string;
  }> = [];
  let conflictsAvoided = 0;

  for (const session of plan.sessions) {
    const slot = await findOpenSlotViaFreeBusy(
      accessToken,
      session.scheduledDate,
      windowConfig
    );
    if (slot.conflictResolved) {
      conflictsAvoided++;
    }

    const summary = `[Practice Buddy] #${session.sessionNumber}: ${plan.topicTitle} (${session.stageName})`;
    const description = buildSessionSyncDescription(plan, session);
    const deepLink = buildSessionDeepLink(plan.id, session.id);

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary,
          description,
          location: deepLink,
          start: {
            dateTime: slot.startIso,
            timeZone,
          },
          end: {
            dateTime: slot.endIso,
            timeZone,
          },
          source: {
            title: 'Practice Buddy Quiz Studio',
            url: deepLink,
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 15 },
              { method: 'email', minutes: 60 },
            ],
          },
        }),
      }
    );

    if (res.ok) {
      const created = await res.json();
      mappings.push({
        sessionId: session.id,
        calendarEventId: created.id,
        htmlLink: created.htmlLink,
      });
    }
  }

  return {
    syncedCount: mappings.length,
    conflictsAvoided,
    mappings,
  };
}

/**
 * Method 1B: Batch Sync Sessions to Google Tasks (`https://www.googleapis.com/tasks/v1`).
 */
export async function syncPlanToGoogleTasks(
  plan: StudyPlan,
  clientId: string
): Promise<{
  syncedCount: number;
  mappings: Array<{ sessionId: number; calendarEventId: string }>;
}> {
  const accessToken = await requestGoogleOAuthToken(clientId, [
    'https://www.googleapis.com/auth/tasks',
  ]);

  const mappings: Array<{ sessionId: number; calendarEventId: string }> = [];

  for (const session of plan.sessions) {
    const title = `[Practice Buddy #${session.sessionNumber}] ${plan.topicTitle} — ${session.stageName}`;
    const notes = buildSessionSyncDescription(plan, session);
    const dueDate = parseLocalDate(session.scheduledDate);
    dueDate.setUTCHours(12, 0, 0, 0);

    const res = await fetch(
      'https://www.googleapis.com/tasks/v1/lists/@default/tasks',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          notes,
          due: dueDate.toISOString(),
        }),
      }
    );

    if (res.ok) {
      const created = await res.json();
      mappings.push({
        sessionId: session.id,
        calendarEventId: `task:${created.id}`,
      });
    }
  }

  return {
    syncedCount: mappings.length,
    mappings,
  };
}

/**
 * Method 2: Universal .ics File Generator & Browser Download
 */
function formatIcsUtcDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function downloadPlanAsIcs(
  plan: StudyPlan,
  windowConfig?: StudyWindowConfig
): void {
  const [startH, startM] = (windowConfig?.startHour || '09:00')
    .split(':')
    .map(Number);
  const durationMin = windowConfig?.durationMinutes || 30;
  const dtStamp = formatIcsUtcDateTime(new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Practice Buddy//english-3D.com//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Practice Buddy - ${escapeIcsText(plan.topicTitle)}`,
  ];

  for (const session of plan.sessions) {
    const startDt = parseLocalDate(session.scheduledDate);
    startDt.setHours(startH || 9, startM || 0, 0, 0);
    const endDt = new Date(startDt.getTime() + durationMin * 60 * 1000);

    const deepLink = buildSessionDeepLink(plan.id, session.id);
    const summary = `[Practice Buddy #${session.sessionNumber}] ${plan.topicTitle} (${session.stageName})`;
    const description = buildSessionSyncDescription(plan, session);

    lines.push(
      'BEGIN:VEVENT',
      `UID:practicebuddy-plan-${plan.id}-session-${session.id}@english-3D.com`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${formatIcsUtcDateTime(startDt)}`,
      `DTEND:${formatIcsUtcDateTime(endDt)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `LOCATION:${escapeIcsText(deepLink)}`,
      `URL:${deepLink}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Practice Buddy Active-Recall Quiz Due',
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = plan.topicTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  a.href = url;
  a.download = `spaced-practice-${slug || 'schedule'}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Method 3: Direct Google Calendar Template URL for a Single Session
 */
export function buildGoogleCalendarTemplateUrl(
  plan: StudyPlan,
  session: StudySession,
  windowConfig?: StudyWindowConfig
): string {
  const [startH, startM] = (windowConfig?.startHour || '09:00')
    .split(':')
    .map(Number);
  const durationMin = windowConfig?.durationMinutes || 30;

  const startDt = parseLocalDate(session.scheduledDate);
  startDt.setHours(startH || 9, startM || 0, 0, 0);
  const endDt = new Date(startDt.getTime() + durationMin * 60 * 1000);

  const datesParam = `${formatIcsUtcDateTime(startDt)}/${formatIcsUtcDateTime(endDt)}`;
  const title = `[Practice Buddy #${session.sessionNumber}] ${plan.topicTitle} — ${session.stageName}`;
  const details = buildSessionSyncDescription(plan, session);
  const deepLink = buildSessionDeepLink(plan.id, session.id);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: datesParam,
    details,
    location: deepLink,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

