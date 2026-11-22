// src/services/cheesefork.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CourseCatalogItem,
  CourseExam,
  CourseGroupItem,
  DayOfWeek,
} from '../types/schedule';

export const CHEESEFORK_JS_URL =
  'https://sap.cheesefork.cf/courses_2026_200.min.js';

export const CHEESEFORK_CACHE_META_KEY = '@meatspoon_cheesefork_cache_meta_v1';
export const CHEESEFORK_CACHE_CHUNK_PREFIX =
  '@meatspoon_cheesefork_cache_chunk_v1_';
const CACHE_CHUNK_SIZE = 250;

/**
 * Saves the normalized Cheesefork course catalog to AsyncStorage in chunks
 * so large catalogs never exceed Android's 2MB per-row CursorWindow limit
 * or Web storage limits.
 */
export async function saveCachedCheeseforkCatalog(
  courses: CourseCatalogItem[]
): Promise<void> {
  if (!Array.isArray(courses) || courses.length === 0) return;

  try {
    const chunks: CourseCatalogItem[][] = [];
    for (let i = 0; i < courses.length; i += CACHE_CHUNK_SIZE) {
      chunks.push(courses.slice(i, i + CACHE_CHUNK_SIZE));
    }

    const pairs: [string, string][] = chunks.map((chunk, idx) => [
      `${CHEESEFORK_CACHE_CHUNK_PREFIX}${idx}`,
      JSON.stringify(chunk),
    ]);
    pairs.push([
      CHEESEFORK_CACHE_META_KEY,
      JSON.stringify({
        version: 1,
        cachedAt: new Date().toISOString(),
        chunkCount: chunks.length,
        totalCourses: courses.length,
      }),
    ]);

    await AsyncStorage.multiSet(pairs);
  } catch (err) {
    console.warn('Failed to cache Cheesefork catalog to AsyncStorage:', err);
  }
}

/**
 * Loads the last cached Cheesefork course catalog from AsyncStorage for
 * instant startup and offline fallback.
 */
export async function loadCachedCheeseforkCatalog(): Promise<
  CourseCatalogItem[]
> {
  try {
    const rawMeta = await AsyncStorage.getItem(CHEESEFORK_CACHE_META_KEY);
    if (!rawMeta) return [];

    const meta = JSON.parse(rawMeta) as { chunkCount?: number };
    const chunkCount = Number(meta?.chunkCount || 0);
    if (chunkCount <= 0) return [];

    const keys = Array.from(
      { length: chunkCount },
      (_, idx) => `${CHEESEFORK_CACHE_CHUNK_PREFIX}${idx}`
    );
    const entries = await AsyncStorage.multiGet(keys);

    const courses: CourseCatalogItem[] = [];
    for (const [, value] of entries) {
      if (!value) continue;
      const parsedChunk = JSON.parse(value);
      if (Array.isArray(parsedChunk)) {
        courses.push(...parsedChunk);
      }
    }
    return courses;
  } catch (err) {
    console.warn('Failed to load cached Cheesefork catalog:', err);
    return [];
  }
}

/**
 * Fetches live Cheesefork course data and updates the local cache.
 * If the device is offline or the fetch fails, gracefully falls back to the
 * last cached catalog without throwing when cached data is available.
 */
export async function syncCheeseforkCatalogWithCache(): Promise<{
  courses: CourseCatalogItem[];
  fromCache: boolean;
}> {
  try {
    const liveCourses = await fetchCheeseforkCatalog();
    await saveCachedCheeseforkCatalog(liveCourses);
    return { courses: liveCourses, fromCache: false };
  } catch (fetchErr) {
    const cachedCourses = await loadCachedCheeseforkCatalog();
    if (cachedCourses.length > 0) {
      return { courses: cachedCourses, fromCache: true };
    }
    throw fetchErr;
  }
}

/**
 * 1. Fetches the Cheesefork JS script directly via HTTP:
 *    https://sap.cheesefork.cf/courses_2026_200.min.js
 * 2. Extracts the raw JSON payload assigned to the JS variable using Regex / string slicing.
 * 3. Parses the extracted string with JSON.parse().
 * 4. Maps the real Technion courses, schedules, and exam dates (Moed A / Moed B) into CourseCatalogItem[].
 */
export async function fetchCheeseforkCatalog(): Promise<CourseCatalogItem[]> {
  const response = await fetch(CHEESEFORK_JS_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Cheesefork JS file (${response.status} ${response.statusText})`
    );
  }

  const jsText = await response.text();
  const jsonString = extractJsonFromJsAssignment(jsText);
  const parsed = JSON.parse(jsonString);

  const rawCourses: any[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null
    ? Object.values(parsed)
    : [];

  return rawCourses
    .map((raw) => normalizeCourseObject(raw))
    .filter((course) => Boolean(course.courseId));
}

/**
 * Merges groups of the same course that share the exact same type, instructor,
 * session days/times, and room into a single CourseGroupItem with bracketed
 * group numbers (e.g., "[10], [11], [12]").
 */
export function mergeIdenticalCourseGroups(
  groups: CourseGroupItem[]
): CourseGroupItem[] {
  const mergedMap = new Map<
    string,
    {
      rawIds: string[];
      type: 'Lecture' | 'Tutorial' | 'Lab';
      lecturer: string;
      sessions: CourseGroupItem['sessions'];
    }
  >();

  for (const grp of groups) {
    const sortedSessionsSig = [...grp.sessions]
      .sort((a, b) =>
        a.day !== b.day ? a.day - b.day : a.startHour - b.startHour
      )
      .map(
        (s) =>
          `${s.day}:${s.startHour.toFixed(2)}-${s.endHour.toFixed(2)}@${s.location
            .trim()
            .toLowerCase()}`
      )
      .join('|');

    const signature = `${grp.type}__${grp.lecturer
      .trim()
      .toLowerCase()}__${sortedSessionsSig}`;

    const idsToAdd =
      grp.rawGroupIds && grp.rawGroupIds.length > 0
        ? grp.rawGroupIds
        : [grp.groupId.replace(/[\[\]]/g, '').trim()];

    if (!mergedMap.has(signature)) {
      mergedMap.set(signature, {
        rawIds: [...idsToAdd],
        type: grp.type,
        lecturer: grp.lecturer,
        sessions: grp.sessions,
      });
    } else {
      const existing = mergedMap.get(signature)!;
      for (const id of idsToAdd) {
        if (!existing.rawIds.includes(id)) {
          existing.rawIds.push(id);
        }
      }
    }
  }

  return Array.from(mergedMap.values()).map((entry) => ({
    groupId: entry.rawIds.map((id) => `[${id}]`).join(', '),
    rawGroupIds: entry.rawIds,
    type: entry.type,
    lecturer: entry.lecturer,
    sessions: entry.sessions,
  }));
}

/**
 * Extracts the raw JSON array or object from a JS variable assignment script
 * (e.g. `var courses_from_rishum = [...];`).
 */
export function extractJsonFromJsAssignment(jsText: string): string {
  const trimmed = jsText.trim();

  // Strip leading variable declaration/assignment (e.g., `var courses_from_rishum = `)
  const withoutAssignment = trimmed.replace(
    /^\s*(?:(?:var|let|const)\s+)?[\w$]+(?:\.[\w$]+)*\s*=\s*/,
    ''
  );

  // Strip trailing semicolon(s) and whitespace
  const cleaned = withoutAssignment.replace(/;+\s*$/, '').trim();

  if (
    (cleaned.startsWith('[') && cleaned.endsWith(']')) ||
    (cleaned.startsWith('{') && cleaned.endsWith('}'))
  ) {
    return cleaned;
  }

  // Fallback slice from first '[' or '{' to last matching ']' or '}'
  const firstBracket = trimmed.indexOf('[');
  const firstBrace = trimmed.indexOf('{');

  if (
    firstBracket !== -1 &&
    (firstBrace === -1 || firstBracket < firstBrace)
  ) {
    const lastBracket = trimmed.lastIndexOf(']');
    if (lastBracket > firstBracket) {
      return trimmed.slice(firstBracket, lastBracket + 1);
    }
  }

  if (firstBrace !== -1) {
    const lastBrace = trimmed.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }
  }

  throw new Error('Could not extract JSON payload from Cheesefork JS file.');
}

/**
 * Normalizes a course entry from the Cheesefork JS file into CourseCatalogItem.
 */
function normalizeCourseObject(raw: any): CourseCatalogItem {
  const general = raw?.general || raw || {};
  const courseId = String(
    general['מספר מקצוע'] ??
      general['מספר קורס'] ??
      raw?.courseId ??
      raw?.number ??
      raw?.id ??
      ''
  ).trim();

  const name = String(
    general['שם מקצוע'] ??
      general['שם קורס'] ??
      raw?.name ??
      raw?.title ??
      'Technion Course'
  ).trim();

  const exams = parseCourseExams(general, courseId, name);

  const scheduleList: any[] = Array.isArray(raw?.schedule) ? raw.schedule : [];

  const groupedMap = new Map<
    string,
    CourseGroupItem
  >();

  for (const item of scheduleList) {
    const groupId = String(item['קבוצה'] ?? item.groupId ?? item.group ?? '01').trim();
    const rawType = String(item['סוג'] ?? item.type ?? '').trim();
    const type = normalizeGroupType(rawType);
    const lecturer =
      String(
        item['מרצה/מתרגל'] ??
          item['מרצה'] ??
          item['מתרגל'] ??
          item.lecturer ??
          ''
      ).trim() || 'TBA';

    const day = parseHebrewDay(String(item['יום'] ?? item.day ?? ''));
    if (day === null) continue;

    const [startHour, endHour] = parseTimeRange(
      String(item['שעה'] ?? item.time ?? '')
    );

    const building = String(item['בניין'] ?? '').trim();
    const room = String(item['חדר'] ?? '').trim();
    const location =
      item.location != null
        ? String(item.location).trim()
        : `${building} ${room}`.trim();

    const mapKey = `${type}_${groupId}`;
    if (!groupedMap.has(mapKey)) {
      groupedMap.set(mapKey, {
        groupId,
        rawGroupIds: [groupId],
        type,
        lecturer,
        sessions: [],
      });
    } else if (
      groupedMap.get(mapKey)!.lecturer === 'TBA' &&
      lecturer !== 'TBA'
    ) {
      groupedMap.get(mapKey)!.lecturer = lecturer;
    }

    // Avoid duplicate identical session entries within the same group
    const groupEntry = groupedMap.get(mapKey)!;
    const isDuplicate = groupEntry.sessions.some(
      (s) =>
        s.day === day &&
        s.startHour === startHour &&
        s.endHour === endHour &&
        s.location === location
    );
    if (!isDuplicate) {
      groupEntry.sessions.push({
        day,
        startHour,
        endHour,
        location,
      });
    }
  }

  return {
    courseId,
    name,
    groups: Array.from(groupedMap.values()),
    exams,
  };
}

/**
 * Extracts Moed A, Moed B, and any other exam dates from Cheesefork's `general` object.
 */
function parseCourseExams(
  general: Record<string, any>,
  courseId: string,
  courseName: string
): CourseExam[] {
  const exams: CourseExam[] = [];
  if (!general || typeof general !== 'object') return exams;

  for (const [key, val] of Object.entries(general)) {
    if (!val || typeof val !== 'string') continue;

    const isExamKey =
      key.includes('מועד') ||
      key.includes('מבחן') ||
      key.includes('בוחן') ||
      key.toLowerCase().includes('moed') ||
      key.toLowerCase().includes('exam');

    if (!isExamKey) continue;

    const rawText = val.trim();
    if (!rawText) continue;

    const parsedDate = extractDateFromExamString(rawText);
    if (!parsedDate) continue;

    const [startHour, endHour] = extractExamHours(rawText);
    const moedLabel = formatMoedLabel(key);

    exams.push({
      id: `exam-${courseId}-${moedLabel}-${parsedDate.dateISO}`,
      courseId,
      courseName,
      moedLabel,
      dateISO: parsedDate.dateISO,
      displayDate: parsedDate.displayDate,
      startHour,
      endHour,
      rawText,
    });
  }

  return exams;
}

function formatMoedLabel(rawKey: string): string {
  if (rawKey.includes('מועד א')) return "Moed A (מועד א')";
  if (rawKey.includes('מועד ב')) return "Moed B (מועד ב')";
  if (rawKey.includes('מועד ג')) return "Moed C (מועד ג')";
  return rawKey.trim();
}

function extractDateFromExamString(
  text: string
): { dateISO: string; displayDate: string } | null {
  const dmyMatch = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (dmyMatch) {
    const dayNum = parseInt(dmyMatch[1], 10);
    const monthNum = parseInt(dmyMatch[2], 10);
    let yearNum = parseInt(dmyMatch[3], 10);
    if (yearNum < 100) yearNum += 2000;

    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      const dd = String(dayNum).padStart(2, '0');
      const mm = String(monthNum).padStart(2, '0');
      const yyyy = String(yearNum);
      return {
        dateISO: `${yyyy}-${mm}-${dd}`,
        displayDate: `${dd}/${mm}/${yyyy}`,
      };
    }
  }

  const ymdMatch = text.match(/\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (ymdMatch) {
    const yyyy = ymdMatch[1];
    const mm = String(parseInt(ymdMatch[2], 10)).padStart(2, '0');
    const dd = String(parseInt(ymdMatch[3], 10)).padStart(2, '0');
    return {
      dateISO: `${yyyy}-${mm}-${dd}`,
      displayDate: `${dd}/${mm}/${yyyy}`,
    };
  }

  return null;
}

function extractExamHours(text: string): [number, number] {
  const rangeMatch = text.match(
    /(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/
  );
  if (rangeMatch) {
    const start = parseTimeString(rangeMatch[1]);
    const end = parseTimeString(rangeMatch[2]);
    if (end > start) return [start, end];
  }

  const singleTimeMatch = text.match(/\b(\d{1,2}:\d{2})\b/);
  if (singleTimeMatch) {
    const start = parseTimeString(singleTimeMatch[1]);
    return [start, Math.min(start + 3, 20)];
  }

  return [9.0, 12.0];
}

function normalizeGroupType(rawType: string): 'Lecture' | 'Tutorial' | 'Lab' {
  const lower = rawType.toLowerCase();
  if (rawType.includes('הרצאה') || lower.includes('lec')) return 'Lecture';
  if (rawType.includes('מעבדה') || rawType.includes('פרויקט') || lower.includes('lab'))
    return 'Lab';
  return 'Tutorial';
}

function parseHebrewDay(dayStr: string): DayOfWeek | null {
  const s = dayStr.trim();
  if (!s) return null;
  if (s.includes('ראשון') || s === 'א' || s === "א'") return 0;
  if (s.includes('שני') || s === 'ב' || s === "ב'") return 1;
  if (s.includes('שלישי') || s === 'ג' || s === "ג'") return 2;
  if (s.includes('רביעי') || s === 'ד' || s === "ד'") return 3;
  if (s.includes('חמישי') || s === 'ה' || s === "ה'") return 4;
  return null;
}

function parseTimeRange(rangeStr: string): [number, number] {
  const parts = rangeStr.split('-').map((s) => s.trim());
  if (parts.length !== 2) return [8.5, 10.5];
  const start = parseTimeString(parts[0]);
  const end = parseTimeString(parts[1]);
  return end > start ? [start, end] : [start, start + 1];
}

function parseTimeString(t: string): number {
  const [hStr, mStr] = t.trim().split(/[:.]/);
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  if (isNaN(h)) return 8.5;
  return h + m / 60;
}
