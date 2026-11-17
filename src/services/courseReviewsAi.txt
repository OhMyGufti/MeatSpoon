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

export const GEMINI_COURSE_REVIEWS_SYSTEM_INSTRUCTION = `אתה עוזר וירטואלי לסטודנטים בטכניון. קרא את כל הביקורות הגולמיות הבאות על הקורס. חלץ ונתח אותן, והחזר את התשובה אך ורק במבנה ה-JSON הבא:

generalCourseSummary: פסקה אחת שמסכמת את הדעה הכללית על הקורס עצמו (רמת קושי, עומס, עניין).

staff: מערך של אובייקטים המייצגים מרצים או מתרגלים שזוהו בביקורות. לכל אחד: name (שם איש הסגל), role (מרצה או מתרגל), rating (ציון משוקלל בין 1 ל-5), ו-summary (סיכום קצר של הביקורות עליו).

additionalReviews: מערך של אנשי סגל או שמות שעלו בביקורות אבל לא ברור תפקידם, או ביקורות שלא שויכו לאף אחד ספציפי. (אותו מבנה אובייקט כמו בסעיף הקודם).
ענה בעברית בלבד.`;

/**
 * Placeholder service function that returns a mocked array of raw student reviews
 * from CheeseFork (mixing general course impressions, specific lecturers, TAs, and unattributed feedback).
 */
export async function fetchRawCourseReviews(courseId: string): Promise<string[]> {
  // Simulate brief network latency
  await new Promise((resolve) => setTimeout(resolve, 250));

  return [
    `קורס ${courseId} הוא אחד הקורסים החשובים והמעניינים בתואר, אבל אל תזלזלו בעומס שלו! גיליונות הבית דורשים המון השקעה ולוקחים לפחות יומיים בשבוע, והמבחן הסופי ברמה גבוהה מאוד אך הוגן למי שפתר מבחנים משנים קודמות.`,
    `המרצה פרופ' דן גייגר מעביר את החומר בצורה מרתקת ובהירה מאוד. ההרצאות שלו מסודרות, הוא עונה בסבלנות על שאלות ומביא דוגמאות מצוינות שממש עוזרות להבין את האינטואיציה שמאחורי המשפטים. מומלץ בחום להגיע להרצאות שלו (5/5).`,
    `המרצה ד"ר יעל כהן נחמדה מאוד ומשתדלת לעזור בשעות קבלה, אבל לפעמים היא רצה מהר מדי על השקפים וההסברים בכיתה קצת פחות אינטואיטיביים לחלק הראשון של הסמסטר (3.5/5).`,
    `המתרגל תומר לוי פשוט אלוף! התרגולים שלו מצילים את הקורס. הוא פותר שאלות ברמת מבחן שלב אחר שלב, מסכם את כל הטריקים החשובים על הלוח ותמיד זמין במייל לשאלות. אל תפספסו את הקבוצה שלו!`,
    `המתרגלת נועה שפירא מעבירה את התרגול בצורה מסודרת וברורה, הקצב שלה טוב והיא מחלקת דפי סיכום מעולים לפני המבחן, אם כי לפעמים לא מספיקים את כל השאלות בדף התרגול (4/5).`,
    `שמעתי מסטודנטים שלקחו עם אלון ברק שהמצגות שלו מעולות ומומלץ להוריד אותן מהמודל, למרות שלא ברור אם הוא מרצה או מתרגל אחראי הסמסטר.`,
    `טיפ כללי לכל מי שלוקח את הקורס: תתחילו את המטלות הרטובות מוקדם עם שותף טוב, ותפתרו לפחות 6-7 מבחנים ממועדים אחרונים כי שאלות הקצה במבחן חוזרות על רעיונות דומים מהתרגולים.`,
  ];
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
 * 2. If not cached, fetches raw reviews via `fetchRawCourseReviews(courseId)`,
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

  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
  if (!apiKey.trim()) {
    throw new Error(
      'חסר מפתח API של Gemini (EXPO_PUBLIC_GEMINI_API_KEY אינו מוגדר בסביבה).'
    );
  }

  try {
    const rawReviews = await fetchRawCourseReviews(courseId);

    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: GEMINI_COURSE_REVIEWS_SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const userPrompt = `מספר קורס: ${courseId}\n\nלהלן הביקורות הגולמיות של הסטודנטים על הקורס:\n${JSON.stringify(
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
