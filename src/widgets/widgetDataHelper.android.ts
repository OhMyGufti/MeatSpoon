// src/widgets/widgetDataHelper.android.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ASYNC_STORAGE_KEY,
  CourseTask,
  LocalBackupPayload,
  ScheduleEvent,
} from '../types/schedule';
import { isTaskDismissed } from '../services/moodleSync';
import { DEFAULT_COLOR_PALETTE } from '../utils/colorPalette';

export interface WidgetPinnedTaskItem {
  id: string;
  title: string;
  color: `#${string}`;
  dueTimeLabel: string;
}

export type WidgetTimelineListItem =
  | {
      kind: 'event';
      event: ScheduleEvent;
      color: `#${string}`;
      timeRangeLabel: string;
    }
  | {
      kind: 'now';
      currentTimeLabel: string;
    };

export interface AndroidWidgetSnapshot {
  dayHeaderLabel: string;
  pinnedTodayTasks: WidgetPinnedTaskItem[];
  timelineItems: WidgetTimelineListItem[];
  freeTimeDuration: number;
  hasFreeTimeInWindow: boolean;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toLocalDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatWidgetHour(decHour: number): string {
  const clamped = Math.max(0, Math.min(23.99, decHour));
  let h = Math.floor(clamped);
  let m = Math.round((clamped - h) * 60);
  if (m >= 60) {
    h = Math.min(23, h + 1);
    m = 0;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getEventRelationKey(ev: ScheduleEvent): string {
  if (ev.courseId) {
    return `course:${ev.courseId}`;
  }
  return `custom:${ev.groupId || ev.title}`;
}

function normalizeHexForWidget(
  rawColor?: string,
  fallback: `#${string}` = '#3B82F6'
): `#${string}` {
  if (!rawColor || typeof rawColor !== 'string') return fallback;
  const trimmed = rawColor.trim();
  if (/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(trimmed)) {
    return trimmed as `#${string}`;
  }
  return fallback;
}

/**
 * Checks whether there is ANY free time gap (unbooked time) within
 * `[currentDecHour, currentDecHour + durationHours]` among today's visible events.
 */
export function checkFreeTimeInLookaheadWindow(
  todayEvents: ScheduleEvent[],
  currentDecHour: number,
  durationHours: number
): boolean {
  const safeDuration = Math.max(1, Math.min(8, Math.round(durationHours || 2)));
  const windowStart = currentDecHour;
  const windowEnd = currentDecHour + safeDuration;

  const intervals: Array<{ start: number; end: number }> = [];
  for (const ev of todayEvents) {
    if (ev.type === 'Task') continue;
    const s = Math.max(windowStart, ev.startHour);
    const e = Math.min(windowEnd, ev.endHour);
    if (e > s) {
      intervals.push({ start: s, end: e });
    }
  }

  if (intervals.length === 0) {
    return true;
  }

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of intervals) {
    if (merged.length === 0) {
      merged.push({ ...iv });
    } else {
      const last = merged[merged.length - 1];
      // Merge overlapping or back-to-back classes (tolerance ~1 minute)
      if (iv.start <= last.end + 0.02) {
        last.end = Math.max(last.end, iv.end);
      } else {
        merged.push({ ...iv });
      }
    }
  }

  let busyHours = 0;
  for (const m of merged) {
    busyHours += Math.max(0, m.end - m.start);
  }

  // If busy time covers the entire lookahead window, there is NO free time
  return busyHours < safeDuration - 0.02;
}

export async function loadAndroidWidgetSnapshot(
  now: Date = new Date()
): Promise<AndroidWidgetSnapshot> {
  let parsed: Partial<LocalBackupPayload> = {};
  try {
    const raw = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        parsed = obj;
      }
    }
  } catch (err) {
    console.warn('Widget failed to read AsyncStorage:', err);
  }

  const events: ScheduleEvent[] = Array.isArray(parsed.events)
    ? parsed.events
    : [];
  const tasks: CourseTask[] = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const dismissedTaskIds: string[] = Array.isArray(parsed.dismissedTaskIds)
    ? parsed.dismissedTaskIds
    : [];
  const hiddenKeys: Record<string, boolean> =
    parsed.hiddenKeys && typeof parsed.hiddenKeys === 'object'
      ? parsed.hiddenKeys
      : {};
  const rawDuration =
    typeof parsed.freeTimeDuration === 'number' ? parsed.freeTimeDuration : 2;
  const freeTimeDuration = Math.max(1, Math.min(8, Math.round(rawDuration)));

  const palette =
    parsed.customPaletteEnabled &&
    Array.isArray(parsed.customPalette) &&
    parsed.customPalette.length === 8
      ? parsed.customPalette
      : DEFAULT_COLOR_PALETTE;

  const todayDay = now.getDay(); // 0 = Sun .. 6 = Sat
  const todayISO = toLocalDateISO(now);
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dayHeaderLabel = `${DAY_NAMES[todayDay] || 'Today'} ${dd}/${mm}`;

  // 1. Resolve today's active (non-DONE) pinned tasks
  const activeTasks = tasks.filter(
    (t) =>
      !dismissedTaskIds.includes(t.id) &&
      !isTaskDismissed(t, dismissedTaskIds) &&
      !hiddenKeys[t.relationKey]
  );

  const pinnedTodayTasks: WidgetPinnedTaskItem[] = [];
  for (const tsk of activeTasks) {
    const d = new Date(tsk.deadlineISO);
    if (Number.isNaN(d.getTime())) continue;
    const taskISO = toLocalDateISO(d);
    if (taskISO !== todayISO) continue;

    const matchedEv = events.find(
      (e) =>
        getEventRelationKey(e) === tsk.relationKey ||
        (tsk.courseId && e.courseId === tsk.courseId)
    );
    const color = normalizeHexForWidget(
      tsk.color || matchedEv?.color || palette[0]
    );
    const dueHH = String(d.getHours()).padStart(2, '0');
    const dueMM = String(d.getMinutes()).padStart(2, '0');
    pinnedTodayTasks.push({
      id: tsk.id,
      title: tsk.title,
      color,
      dueTimeLabel: `${dueHH}:${dueMM}`,
    });
  }

  // 2. Resolve today's visible scheduled events sorted chronologically
  const todayEvents = events
    .filter((ev) => {
      if (hiddenKeys[getEventRelationKey(ev)]) return false;
      if (ev.type === 'Exam') {
        return ev.examDateISO === todayISO;
      }
      return ev.day === todayDay;
    })
    .sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);

  const currentDecHour = now.getHours() + now.getMinutes() / 60;
  const currentTimeLabel = `${String(now.getHours()).padStart(
    2,
    '0'
  )}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 3. Build chronological list with Current-Time Gray Timeline Indicator inserted at the exact position
  const timelineItems: WidgetTimelineListItem[] = [];
  let insertedNowLine = false;

  for (const ev of todayEvents) {
    if (!insertedNowLine && currentDecHour < ev.startHour) {
      timelineItems.push({
        kind: 'now',
        currentTimeLabel,
      });
      insertedNowLine = true;
    }

    timelineItems.push({
      kind: 'event',
      event: ev,
      color: normalizeHexForWidget(ev.color, '#2563EB'),
      timeRangeLabel: `${formatWidgetHour(ev.startHour)} – ${formatWidgetHour(
        ev.endHour
      )}`,
    });
  }

  if (!insertedNowLine) {
    timelineItems.push({
      kind: 'now',
      currentTimeLabel,
    });
  }

  // 4. Determine if there is any free time within the next `freeTimeDuration` hours
  const hasFreeTimeInWindow = checkFreeTimeInLookaheadWindow(
    todayEvents,
    currentDecHour,
    freeTimeDuration
  );

  return {
    dayHeaderLabel,
    pinnedTodayTasks,
    timelineItems,
    freeTimeDuration,
    hasFreeTimeInWindow,
  };
}
