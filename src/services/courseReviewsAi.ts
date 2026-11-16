// src/services/courseReviewsAi.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface CourseStaffReviewItem {
  name: string;
  role: string;
  rating: number;
  summary: string;
}

export interface CourseReviewsAiSummary {
  generalCourseSummary: string;
  staff: CourseStaffReviewItem[];
  additionalReviews: CourseStaffReviewItem[];
}

export const COURSE_SUMMARY_CACHE_PREFIX = '@MeatSpoon_CourseSummary_';

/**
 * CheeseFork's public Firebase project ID (can be overridden via EXPO_PUBLIC_CHEESEFORK_PROJECT_ID).
 * Collection: `courseFeedback`
 * Document ID: `${courseId}`
 * Field: `posts` (array of mapValues containing `text`, `semester`, `generalRank`, `difficultyRank`, `author`, `timestamp`)
 */
export const CHEESEFORK_FIREBASE_PROJECT_ID =
  process.env.EXPO_PUBLIC_CHEESEFORK_PROJECT_ID || 'cheesefork-de9af';

export const GEMINI_COURSE_REVIEWS_SYSTEM_INSTRUCTION = `אתה עוזר וירטואלי לסטודנטים בטכניון. קרא את כל הביקורות הגולמיות הבאות על הקורס. חלץ ונתח אותן, והחזר את התשובה אך ורק במבנה ה-JSON הבא:

generalCourseSummary: פסקה אחת שמסכמת את הדעה הכללית על הקורס עצמו (רמת קושי, עומס, עניין).

staff: מערך של אובייקטים המייצגים מרצים או מתרגלים שזוהו בביקורות. לכל אחד: name (שם איש הסגל), role (מרצה או מתרגל), rating (ציון משוקלל בין 1 ל-5), ו-summary (סיכום קצר של הביקורות עליו).

additionalReviews: מערך של אנשי סגל או שמות שעלו בביקורות אבל לא ברור תפקידם, או ביקורות שלא שויכו לאף אחד ספציפי. (אותו מבנה אובייקט כמו בסעיף הקודם).
ענה בעברית בלבד.`;

/**
 * Cleans unfilled template headers from a CheeseFork review post,
 * matching `preprocessPostText` in CheeseFork's `course-feedback.js`.
 */
export function preprocessCheeseForkPostText(rawText: string): string {
  let text = rawText || '';
  const templateParts = [
    'שם המרצה:',
    'חוות דעת - הרצאות:',
    'שם המתרגל/ת:',
    'חוות דעת - תרגולים:',
    'שעורי הבית:',
    'המבחן:',
    'השורה התחתונה:',
  ].filter((part) => text.indexOf(part) !== -1);

  for (let i = 0; i + 1 < templateParts.length; i++) {
    const t1 = templateParts[i];
    const t2 = templateParts[i + 1];
    const regex = new RegExp(`${t1}\\s*${t2}`);
    text = text.replace(regex, t2);
  }

  if (templateParts.length > 0) {
    const t1Last = templateParts[templateParts.length - 1];
    const regexLast = new RegExp(`${t1Last}\\s*$`);
    text = text.replace(regexLast, '');
  }

  return text.trim();
}

/**
 * Converts a Technion 8-digit SAP course ID (e.g. "02340124") to its legacy 6-digit ID ("234124")
 * so we can query both if needed.
 */
function toLegacy6DigitCourseId(courseId: string): string | null {
  const trimmed = courseId.trim();
  if (/^0\d{3}0\d{3}$/.test(trimmed)) {
    return trimmed.slice(1, 4) + trimmed.slice(5, 8);
  }
  return null;
}

/**
 * Extracts the string array of reviews from a Firestore REST API document JSON response
 * for `projects/{projectId}/databases/(default)/documents/courseFeedback/{courseId}`.
 */
function extractReviewsFromFirestoreRestDoc(docJson: any): string[] {
  const values = docJson?.fields?.posts?.arrayValue?.values;
  if (!Array.isArray(values)) {
    return [];
  }

  const extractedReviews: string[] = [];

  for (const item of values) {
    const postFields = item?.mapValue?.fields;
    if (!postFields) continue;

    const rawText = String(postFields?.text?.stringValue || '').trim();
    if (!rawText) continue;

    const cleanedText = preprocessCheeseForkPostText(rawText);
    if (!cleanedText) continue;

    const semester = String(postFields?.semester?.stringValue || '').trim();
    const generalRank = Number(
      postFields?.generalRank?.integerValue ??
        postFields?.generalRank?.doubleValue ??
        NaN
    );
    const difficultyRank = Number(
      postFields?.difficultyRank?.integerValue ??
        postFields?.difficultyRank?.doubleValue ??
        NaN
    );

    const metaParts: string[] = [];
    if (semester) metaParts.push(`סמסטר: ${semester}`);
    if (Number.isFinite(generalRank) && generalRank > 0) {
      metaParts.push(`דירוג כללי: ${generalRank}/5`);
    }
    if (Number.isFinite(difficultyRank) && difficultyRank > 0) {
      metaParts.push(`דירוג עומס: ${difficultyRank}/5`);
    }

    const formattedReview =
      metaParts.length > 0
        ? `[${metaParts.join(' | ')}]\n${cleanedText}`
        : cleanedText;

    extractedReviews.push(formattedReview);
  }

  return extractedReviews;
}

/**
 * Helper that queries a single document ID in the `courseFeedback` collection
 * via the public Firebase Firestore v1 REST API.
 */
async function fetchFirestoreCourseFeedbackDoc(
  docId: string
): Promise<string[]> {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    CHEESEFORK_FIREBASE_PROJECT_ID
  )}/databases/(default)/documents/courseFeedback/${encodeURIComponent(docId)}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(
      `שגיאה בשליפת ביקורות מ-CheeseFork (HTTP ${response.status}).`
    );
  }

  const docJson = await response.json();
  return extractReviewsFromFirestoreRestDoc(docJson);
}

/**
 * Fetches raw student reviews for `courseId` from CheeseFork's public Firestore database
 * (`collection('courseFeedback').doc(courseId)`) using the public Firebase REST API.
 * Queries both the given `courseId` (e.g. 8-digit SAP ID "02340124") and its 6-digit
 * legacy Technion ID ("234124") if applicable, combining unique reviews.
 */
export async function fetchRawCourseReviews(
  courseId: string
): Promise<string[]> {
  const cleanId = courseId.trim();
  if (!cleanId) return [];

  const primaryReviews = await fetchFirestoreCourseFeedbackDoc(cleanId);

  const legacyId = toLegacy6DigitCourseId(cleanId);
  if (!legacyId || legacyId === cleanId) {
    return primaryReviews;
  }

  try {
    const legacyReviews = await fetchFirestoreCourseFeedbackDoc(legacyId);
    if (legacyReviews.length === 0) {
      return primaryReviews;
    }
    return Array.from(new Set([...primaryReviews, ...legacyReviews]));
  } catch {
    return primaryReviews;
  }
}

export class GeminiQuotaExceededError extends Error {
  public readonly isQuotaExceeded = true;
  constructor(message = 'המערכת עמוסה כרגע, נסה שוב מחר') {
    super(message);
    this.name = 'GeminiQuotaExceededError';
  }
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  if (
    typeof err === 'object' &&
    'isQuotaExceeded' in err &&
    (err as any).isQuotaExceeded === true
  ) {
    return true;
  }
  const msg = String((err as any)?.message || err || '').toLowerCase();
  const status = (err as any)?.status || (err as any)?.httpStatus;
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit')
  );
}

function normalizeStaffArray(rawArr: unknown): CourseStaffReviewItem[] {
  if (!Array.isArray(rawArr)) return [];
  return rawArr
    .map((item: any) => {
      const name = String(item?.name || 'ללא שם').trim();
      const role = String(item?.role || 'לא צוין').trim();
      const rawRating = Number(item?.rating);
      const rating = Number.isFinite(rawRating)
        ? Math.min(5, Math.max(1, Math.round(rawRating * 10) / 10))
        : 4;
      const summary = String(item?.summary || '').trim();
      return { name, role, rating, summary };
    })
    .filter((item) => item.name.length > 0 && item.summary.length > 0);
}

function normalizeParsedSummary(parsed: any): CourseReviewsAiSummary {
  const generalCourseSummary = String(
    parsed?.generalCourseSummary || 'לא נמצא סיכום כללי לקורס זה.'
  ).trim();
  const staff = normalizeStaffArray(parsed?.staff);
  const additionalReviews = normalizeStaffArray(parsed?.additionalReviews);

  return {
    generalCourseSummary,
    staff,
    additionalReviews,
  };
}

/**
 * Clears the cached AI course summary for a specific courseId from AsyncStorage.
 */
export async function clearCachedCourseSummary(courseId: string): Promise<void> {
  const cacheKey = `${COURSE_SUMMARY_CACHE_PREFIX}${courseId}`;
  await AsyncStorage.removeItem(cacheKey);
}

/**
 * Gets the AI-generated course reviews summary for `courseId`.
 * 1. Checks AsyncStorage (`@MeatSpoon_CourseSummary_${courseId}`) unless `forceRefresh` is true.
 * 2. If not cached, fetches raw reviews via `fetchRawCourseReviews(courseId)` from CheeseFork's Firestore REST API,
 *    calls Gemini (`gemini-2.5-flash` in JSON mode), parses the response, and caches it.
 */
export async function getCourseReviewsAiSummary(
  courseId: string,
  options?: { forceRefresh?: boolean }
): Promise<{ summary: CourseReviewsAiSummary; fromCache: boolean }> {
  const cacheKey = `${COURSE_SUMMARY_CACHE_PREFIX}${courseId}`;

  if (options?.forceRefresh) {
    await AsyncStorage.removeItem(cacheKey);
  } else {
    try {
      const cachedJson = await AsyncStorage.getItem(cacheKey);
      if (cachedJson) {
        const parsedCache = JSON.parse(cachedJson);
        if (parsedCache && typeof parsedCache.generalCourseSummary === 'string') {
          return {
            summary: normalizeParsedSummary(parsedCache),
            fromCache: true,
          };
        }
      }
    } catch (cacheErr) {
      console.warn('Failed to read course summary cache:', cacheErr);
    }
  }

  const rawReviews = await fetchRawCourseReviews(courseId);

  if (rawReviews.length === 0) {
    const emptySummary: CourseReviewsAiSummary = {
      generalCourseSummary: 'לא קיימות חוות דעת לקורס זה במאגר CheeseFork.',
      staff: [],
      additionalReviews: [],
    };
    return {
      summary: emptySummary,
      fromCache: false,
    };
  }

  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
  if (!apiKey.trim()) {
    throw new Error(
      'חסר מפתח API של Gemini (EXPO_PUBLIC_GEMINI_API_KEY אינו מוגדר בסביבה).'
    );
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: GEMINI_COURSE_REVIEWS_SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const userPrompt = `מספר קורס: ${courseId}\n\nלהלן הביקורות הגולמיות של הסטודנטים על הקורס (${rawReviews.length} ביקורות):\n${JSON.stringify(
      rawReviews,
      null,
      2
    )}`;

    const result = await model.generateContent(userPrompt);
    const responseText = result.response.text();

    const cleanedJsonText = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleanedJsonText);
    const normalized = normalizeParsedSummary(parsed);

    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(normalized));
    } catch (saveErr) {
      console.warn('Failed to save course summary to AsyncStorage:', saveErr);
    }

    return {
      summary: normalized,
      fromCache: false,
    };
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      throw new GeminiQuotaExceededError('המערכת עמוסה כרגע, נסה שוב מחר');
    }
    throw err;
  }
}
