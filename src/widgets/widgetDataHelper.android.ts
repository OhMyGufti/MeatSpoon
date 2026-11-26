// src/widgets/widgetDataHelper.android.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ASYNC_STORAGE_KEY,
  CourseCatalogItem,
  CourseTask,
  LocalBackupPayload,
  ScheduleEvent,
} from '../types/schedule';
import {
  loadCachedCheeseforkCatalog,
  mergeIdenticalCourseGroups,
} from '../services/cheesefork';
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
      /**
       * Defined (0..1) when `now` is currently inside `[event.startHour, event.endHour]`.
       * Used by `DailyScheduleWidget` to overlay the gray timeline bar across the card via `OverlapWidget`.
       */
      ongoingProgress?: number;
      /**
       * Hourly markers (e.g. ["08:00", "09:00"]) for the optional left time-axis column.
       */
      axisHourLabels: string[];
    }
  | {
      kind: 'gap';
      gapStartHour: number;
      gapEndHour: number;
      durationHours: number;
      /**
       * Defined (0..1) when `now` falls inside this time gap between two non-consecutive events.
       */
      nowProgress?: number;
    }
  | {
      kind: 'now';
    };

export interface AndroidWidgetSnapshot {
  dayHeaderLabel: string;
  pinnedTodayTasks: WidgetPinnedTaskItem[];
  timelineItems: WidgetTimelineListItem[];
  freeTimeDuration: number;
  hasFreeTimeInWindow: boolean;
  widgetShowTimeAxis: boolean;
  widgetFitToLength: boolean;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_SPECIAL_GROUP_FILTERS: Record<string, boolean> = {
  '70-79': false,
  '80-89': true,
  '90-99': false,
  '50-69': true,
  '40-49': true,
  '00-01': false,
};

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

function buildEventAxisHourLabels(startHour: number, endHour: number): string[] {
  const firstH = Math.max(0, Math.min(23, Math.floor(startHour)));
  const lastH = Math.max(
    firstH,
    Math.min(23, Math.floor(Math.max(startHour, endHour - 0.01)))
  );
  const labels: string[] = [];
  for (let h = firstH; h <= lastH; h++) {
    labels.push(`${String(h).padStart(2, '0')}:00`);
  }
  if (labels.length === 0) {
    labels.push(`${String(firstH).padStart(2, '0')}:00`);
  }
  return labels.slice(0, 5);
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

function normalizeCourseDigits(rawId?: string): string[] {
  if (!rawId) return [];
  const digits = rawId.replace(/\D/g, '');
  if (!digits) return [rawId.trim()];
  const variants = new Set<string>([digits]);
  if (digits.length === 6) {
    variants.add(`0${digits}0`);
    variants.add(`0${digits.slice(0, 3)}0${digits.slice(3)}`);
    variants.add(digits.padStart(8, '0'));
  } else if (digits.length === 8) {
    if (digits.startsWith('0') && digits.endsWith('0')) {
      variants.add(digits.slice(1, 7));
    }
    if (digits.startsWith('0') && digits[4] === '0') {
      variants.add(`${digits.slice(1, 4)}${digits.slice(5)}`);
    }
    variants.add(digits.replace(/^0+/, ''));
  }
  return Array.from(variants);
}

function doesCourseIdMatch(idA?: string, idB?: string): boolean {
  if (!idA || !idB) return false;
  if (idA.trim() === idB.trim()) return true;
  const varsA = normalizeCourseDigits(idA);
  const varsB = new Set(normalizeCourseDigits(idB));
  return varsA.some((v) => varsB.has(v));
}

function isGroupAllowedByFilters(
  rawGroupId: string,
  includedFilterIds: Record<string, boolean>
): boolean {
  const trimmed = rawGroupId.replace(/[\[\]]/g, '').trim();
  const parsedNum = parseInt(trimmed, 10);
  if (Number.isNaN(parsedNum)) return true;

  if (parsedNum >= 70 && parsedNum <= 79) {
    return Boolean(includedFilterIds['70-79']);
  }
  if (parsedNum >= 80 && parsedNum <= 89) {
    return Boolean(includedFilterIds['80-89']);
  }
  if (parsedNum >= 90 && parsedNum <= 99) {
    return Boolean(includedFilterIds['90-99']);
  }
  if (parsedNum >= 50 && parsedNum <= 69) {
    return Boolean(includedFilterIds['50-69']);
  }
  if (parsedNum >= 40 && parsedNum <= 49) {
    return Boolean(includedFilterIds['40-49']);
  }
  if (
    parsedNum === 0 ||
    parsedNum === 1 ||
    trimmed === '00' ||
    trimmed === '01' ||
    trimmed === '0' ||
    trimmed === '1'
  ) {
    return Boolean(includedFilterIds['00-01']);
  }
  return true;
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

  return busyHours < safeDuration - 0.02;
}

/**
 * Checks whether there is AT LEAST ONE lecture, tutorial, or lab session from the user's
 * tracked courses starting within `[currentDecHour, currentDecHour + durationHours]`,
 * matching the exact logic of the in-app "Free Time / יש לי זמן פנוי" spontaneous finder.
 */
export function hasTrackedCourseSessionStartingInWindow(
  activeCatalog: CourseCatalogItem[],
  events: ScheduleEvent[],
  tasks: CourseTask[],
  desiredCourseIds: string[],
  includedSpecialGroups: Record<string, boolean>,
  currentDay: number,
  currentDecHour: number,
  durationHours: number
): boolean {
  const safeDuration = Math.max(1, Math.min(8, Math.round(durationHours || 2)));
  const windowEndHour = currentDecHour + safeDuration;

  // Collect all tracked course IDs from events, desiredCourseIds, and tasks
  const trackedIdSet = new Set<string>();
  for (const ev of events) {
    if (ev.courseId) {
      trackedIdSet.add(ev.courseId);
    } else if (ev.type !== 'Custom' && ev.title) {
      const byTitle = activeCatalog.find(
        (c) => c.name.trim().toLowerCase() === ev.title.trim().toLowerCase()
      );
      if (byTitle) trackedIdSet.add(byTitle.courseId);
    }
  }
  for (const cid of desiredCourseIds) {
    if (cid) trackedIdSet.add(cid);
  }
  for (const tsk of tasks) {
    if (tsk.courseId) {
      trackedIdSet.add(tsk.courseId);
    } else if (tsk.relationKey && tsk.relationKey.startsWith('course:')) {
      const rawCid = tsk.relationKey.slice('course:'.length).trim();
      if (rawCid) trackedIdSet.add(rawCid);
    }
  }

  // 1. Check all session components (Lecture, Tutorial, Lab) of followed courses in catalog
  const followedCoursesMap = new Map<string, CourseCatalogItem>();
  for (const cid of trackedIdSet) {
    const matched = activeCatalog.find((c) =>
      doesCourseIdMatch(c.courseId, cid)
    );
    if (matched) {
      followedCoursesMap.set(matched.courseId, matched);
    }
  }
  for (const ev of events) {
    if (ev.type === 'Custom' && !ev.courseId) continue;
    const matched = activeCatalog.find(
      (c) =>
        doesCourseIdMatch(c.courseId, ev.courseId) ||
        (ev.title &&
          c.name.trim().toLowerCase() === ev.title.trim().toLowerCase())
    );
    if (matched) {
      followedCoursesMap.set(matched.courseId, matched);
    }
  }

  const sessionTypes: Array<'Lecture' | 'Tutorial' | 'Lab'> = [
    'Lecture',
    'Tutorial',
    'Lab',
  ];

  for (const course of followedCoursesMap.values()) {
    const candidateGroups: CourseCatalogItem['groups'] = [];
    for (const sType of sessionTypes) {
      const groupsOfType = course.groups.filter((g) => g.type === sType);
      if (groupsOfType.length === 0) continue;
      const allowedOfType = groupsOfType.filter((g) =>
        isGroupAllowedByFilters(g.groupId, includedSpecialGroups)
      );
      candidateGroups.push(
        ...(allowedOfType.length > 0 ? allowedOfType : groupsOfType)
      );
    }

    const mergedGroups = mergeIdenticalCourseGroups(candidateGroups);
    for (const grp of mergedGroups) {
      for (const sess of grp.sessions) {
        if (
          sess.day === currentDay &&
          sess.startHour >= currentDecHour &&
          sess.startHour <= windowEndHour
        ) {
          return true;
        }
      }
    }
  }

  // 2. Fallback check against course events directly in the user's schedule state
  for (const ev of events) {
    if (ev.type === 'Custom' || ev.type === 'Exam' || ev.type === 'Task') {
      continue;
    }
    if (
      ev.day === currentDay &&
      ev.startHour >= currentDecHour &&
      ev.startHour <= windowEndHour
    ) {
      return true;
    }
  }

  return false;
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
  const desiredCourseIds: string[] = Array.isArray(parsed.desiredCourseIds)
    ? parsed.desiredCourseIds
    : [];
  const dismissedTaskIds: string[] = Array.isArray(parsed.dismissedTaskIds)
    ? parsed.dismissedTaskIds
    : [];
  const hiddenKeys: Record<string, boolean> =
    parsed.hiddenKeys && typeof parsed.hiddenKeys === 'object'
      ? parsed.hiddenKeys
      : {};
  const includedSpecialGroups: Record<string, boolean> =
    parsed.includedSpecialGroups &&
    typeof parsed.includedSpecialGroups === 'object'
      ? { ...DEFAULT_SPECIAL_GROUP_FILTERS, ...parsed.includedSpecialGroups }
      : DEFAULT_SPECIAL_GROUP_FILTERS;

  const rawDuration =
    typeof parsed.freeTimeDuration === 'number' ? parsed.freeTimeDuration : 2;
  const freeTimeDuration = Math.max(1, Math.min(8, Math.round(rawDuration)));
  const widgetShowTimeAxis = Boolean(parsed.widgetShowTimeAxis);
  const widgetFitToLength = Boolean(parsed.widgetFitToLength);

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

  // 3. Check if `now` falls inside any ongoing event(s)
  const hasOngoingEvent = todayEvents.some(
    (ev) => currentDecHour >= ev.startHour && currentDecHour <= ev.endHour
  );

  const timelineItems: WidgetTimelineListItem[] = [];
  let insertedStandaloneNowLine = hasOngoingEvent;

  for (let i = 0; i < todayEvents.length; i++) {
    const ev = todayEvents[i];
    const prevEv = i > 0 ? todayEvents[i - 1] : null;

    if (prevEv && ev.startHour - prevEv.endHour > 5 / 60) {
      // Non-consecutive events (gap > 5 minutes): insert a visual gap spacer
      const gapStartHour = prevEv.endHour;
      const gapEndHour = ev.startHour;
      const gapDuration = gapEndHour - gapStartHour;

      let nowProgress: number | undefined = undefined;
      if (
        !insertedStandaloneNowLine &&
        currentDecHour >= gapStartHour &&
        currentDecHour < gapEndHour
      ) {
        nowProgress = Math.max(
          0,
          Math.min(
            1,
            (currentDecHour - gapStartHour) / Math.max(0.1, gapDuration)
          )
        );
        insertedStandaloneNowLine = true;
      }

      timelineItems.push({
        kind: 'gap',
        gapStartHour,
        gapEndHour,
        durationHours: gapDuration,
        nowProgress,
      });
    } else if (!insertedStandaloneNowLine && currentDecHour < ev.startHour) {
      // Before the first event (or between back-to-back events)
      timelineItems.push({ kind: 'now' });
      insertedStandaloneNowLine = true;
    }

    const isOngoing =
      currentDecHour >= ev.startHour && currentDecHour <= ev.endHour;
    const duration = Math.max(0.1, ev.endHour - ev.startHour);
    const ongoingProgress = isOngoing
      ? Math.max(0, Math.min(1, (currentDecHour - ev.startHour) / duration))
      : undefined;

    timelineItems.push({
      kind: 'event',
      event: ev,
      color: normalizeHexForWidget(ev.color, '#2563EB'),
      timeRangeLabel: `${formatWidgetHour(ev.startHour)} – ${formatWidgetHour(
        ev.endHour
      )}`,
      ongoingProgress,
      axisHourLabels: buildEventAxisHourLabels(ev.startHour, ev.endHour),
    });
  }

  if (!insertedStandaloneNowLine) {
    timelineItems.push({ kind: 'now' });
  }

  // 4. Determine FreeTimeWidget color vs. grayscale state:
  // Full color ONLY when:
  // (a) the user has free time in the next `freeTimeDuration` hours, AND
  // (b) there is at least one tracked-course session starting within the next `freeTimeDuration` hours.
  const hasFreeGap = checkFreeTimeInLookaheadWindow(
    todayEvents,
    currentDecHour,
    freeTimeDuration
  );

  let hasFreeTimeInWindow = false;
  if (hasFreeGap) {
    const cachedCatalog = await loadCachedCheeseforkCatalog();
    const hasSpontaneousSession = hasTrackedCourseSessionStartingInWindow(
      cachedCatalog,
      events,
      tasks,
      desiredCourseIds,
      includedSpecialGroups,
      todayDay,
      currentDecHour,
      freeTimeDuration
    );
    hasFreeTimeInWindow = hasSpontaneousSession;
  }

  return {
    dayHeaderLabel,
    pinnedTodayTasks,
    timelineItems,
    freeTimeDuration,
    hasFreeTimeInWindow,
    widgetShowTimeAxis,
    widgetFitToLength,
  };
}
