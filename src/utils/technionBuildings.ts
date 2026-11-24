// src/utils/technionBuildings.ts

export interface TechnionBuildingEntry {
  id: string;
  searchQuery: string;
  aliases: string[];
}

/**
 * Maps common Technion schedule building names & aliases (Hebrew & English)
 * to their exact, unambiguous Google Maps search query (including "טכניון חיפה").
 */
export const TECHNION_BUILDINGS: TechnionBuildingEntry[] = [
  {
    id: 'ullmann',
    searchQuery: 'בניין אולמן טכניון חיפה',
    aliases: ['אולמן', 'אולמאן', 'ullmann', 'ullman', 'ulmann', 'ulman'],
  },
  {
    id: 'taub',
    searchQuery: 'בניין טאוב למדעי המחשב טכניון חיפה',
    aliases: [
      'טאוב',
      'מדעי המחשב',
      'מדמ"ח',
      'מדמח',
      'taub',
      'computer science',
    ],
  },
  {
    id: 'fischbach',
    searchQuery: 'בניין פישבך הנדסת חשמל טכניון חיפה',
    aliases: [
      'פישבך',
      'פישבאך',
      'הנדסת חשמל',
      'חשמל',
      'fischbach',
      'fishbach',
    ],
  },
  {
    id: 'meyer',
    searchQuery: 'בניין מאייר הנדסת חשמל טכניון חיפה',
    aliases: ['מאייר', 'מאיר', 'meyer', 'mayer'],
  },
  {
    id: 'amado',
    searchQuery: 'בניין אמאדו מתמטיקה טכניון חיפה',
    aliases: [
      'עמאדו',
      'אמדו',
      'אמאדו',
      'עמדו',
      'מתמטיקה',
      'amado',
      'mathematics',
    ],
  },
  {
    id: 'sego',
    searchQuery: 'בניין סגו ארכיטקטורה טכניון חיפה',
    aliases: [
      'סגו',
      'ארכיטקטורה',
      'אדריכלות',
      'ארכיטקטורה ובינוי ערים',
      'sego',
      'architecture',
    ],
  },
  {
    id: 'chemical_eng',
    searchQuery: 'הפקולטה להנדסה כימית ע"ש וולפסון טכניון חיפה',
    aliases: [
      'הנדסה כימית',
      'ה. כימית',
      'ה.כימית',
      'וולפסון כימית',
      'chemical engineering',
    ],
  },
  {
    id: 'schulich',
    searchQuery: 'הפקולטה לכימיה ע"ש שוליך טכניון חיפה',
    aliases: [
      'כימיה',
      'שוליך',
      'הפקולטה לכימיה',
      'פקולטה לכימיה',
      'ברנשטיין',
      'schulich',
      'chemistry',
      'bernstein',
    ],
  },
  {
    id: 'biology',
    searchQuery: 'הפקולטה לביולוגיה טכניון חיפה',
    aliases: [
      'ביולוגיה',
      'הפקולטה לביולוגיה',
      'פקולטה לביולוגיה',
      'biology',
    ],
  },
  {
    id: 'borowitz_emerson',
    searchQuery: 'בניין אמרסון מדעי החיים טכניון חיפה',
    aliases: [
      'בורוביץ',
      "בורוביץ'",
      'אמרסון',
      'מדעי החיים',
      'borowitz',
      'borovitz',
      'emerson',
    ],
  },
  {
    id: 'physics_lidow',
    searchQuery: 'בניין לידוב הפקולטה לפיזיקה טכניון חיפה',
    aliases: [
      'פיזיקה',
      'פיסיקה',
      'לידוב',
      'פקולטה לפיזיקה',
      'הפקולטה לפיזיקה',
      'פקולטה לפיסיקה',
      'ורצברגר',
      'רוזן',
      'physics',
      'lidow',
      'lidov',
    ],
  },
  {
    id: 'midan_materials',
    searchQuery: 'הפקולטה למדע והנדסה של חומרים טכניון חיפה',
    aliases: [
      'חומרים',
      'מידן',
      'הנדסת חומרים',
      'מדע והנדסה של חומרים',
      'וולפסון חומרים',
      'midan',
      'meydan',
      'materials',
    ],
  },
  {
    id: 'rabin_civil',
    searchQuery: 'בניין רבין הנדסה אזרחית טכניון חיפה',
    aliases: [
      'רבין',
      'אזרחית',
      'הנדסה אזרחית',
      'אזרחית וסביבתית',
      'הנדסה אזרחית וסביבתית',
      'rabin',
      'civil engineering',
      'civil',
    ],
  },
  {
    id: 'lady_davis',
    searchQuery: 'בניין ליידי דייויס הנדסת מכונות טכניון חיפה',
    aliases: [
      'ליידי דייויס',
      'ליידי דיוויס',
      'לידי דייויס',
      'לידי דיוויס',
      'דייויס',
      'דיוויס',
      'מכונות',
      'הנדסת מכונות',
      'דן קאהן',
      'קאהן',
      'lady davis',
      'dan kahn',
      'kahn',
      'mechanical',
    ],
  },
  {
    id: 'aeronautics',
    searchQuery: 'הפקולטה להנדסת אווירונאוטיקה וחלל טכניון חיפה',
    aliases: [
      'אווירונאוטיקה',
      'אוירונאוטיקה',
      'אווירונאוטיקה וחלל',
      'אוירונאוטיקה וחלל',
      'אווירונוטיקה',
      'חלל',
      'האופטמן',
      'aeronautics',
      'aerospace',
    ],
  },
  {
    id: 'churchill',
    searchQuery: "אודיטוריום צ'רצ'יל טכניון חיפה",
    aliases: ["צ'רצ'יל", 'צרציל', "צ'רציל", "צרצ'יל", 'churchill'],
  },
  {
    id: 'student_house',
    searchQuery: 'בית הסטודנט טכניון חיפה',
    aliases: ['בית הסטודנט', 'הסטודנט', 'student house', 'student union'],
  },
  {
    id: 'bloomfield',
    searchQuery: 'הפקולטה להנדסת תעשייה וניהול טכניון חיפה',
    aliases: [
      'בלומפילד',
      'קופר',
      'תעשייה וניהול',
      'תעשיה וניהול',
      'תעו"נ',
      'תעונ',
      'מדעי הנתונים',
      'מדעי הנתונים וההחלטות',
      'bloomfield',
      'cooper',
      'industrial',
    ],
  },
  {
    id: 'sports_center',
    searchQuery: 'מרכז הספורט טכניון חיפה',
    aliases: [
      'מרכז ספורט',
      'מרכז הספורט',
      'אולם ספורט',
      'בניין ספורט',
      'ספורט',
      'בריכה',
      'בריכת שחייה',
      'מגרש טניס',
      'אצטדיון',
      'sports center',
      'sport',
      'pool',
      'gym',
    ],
  },
  {
    id: 'food_biotech',
    searchQuery: 'הפקולטה להנדסת ביוטכנולוגיה ומזון טכניון חיפה',
    aliases: [
      'ביוטכנולוגיה ומזון',
      'הנדסת מזון',
      'ביוטכנולוגיה',
      'מזון',
      'food',
      'biotechnology',
      'biotech',
    ],
  },
  {
    id: 'biomedical_silver',
    searchQuery: 'בניין סילבר הנדסה ביו-רפואית טכניון חיפה',
    aliases: [
      'סילבר',
      'ביו-רפואית',
      'ביורפואית',
      'ביו רפואית',
      'הנדסה ביו-רפואית',
      'הנדסה ביורפואית',
      'silver',
      'biomedical',
    ],
  },
  {
    id: 'humanities',
    searchQuery: 'המחלקה ללימודים הומניסטיים ואמנויות טכניון חיפה',
    aliases: [
      'הומניסטיים',
      'לימודים הומניסטיים',
      'מדעי הרוח',
      'הומניסטיקה',
      'humanities',
    ],
  },
  {
    id: 'education',
    searchQuery: 'הפקולטה לחינוך למדע וטכנולוגיה טכניון חיפה',
    aliases: [
      'חינוך למדע וטכנולוגיה',
      'חינוך למדע',
      'הוראת המדעים',
      'חינוך',
      'education',
    ],
  },
  {
    id: 'agricultural_lowdermilk',
    searchQuery: 'בניין לאודרמילק הנדסה חקלאית טכניון חיפה',
    aliases: [
      'לאודרמילק',
      'הנדסה חקלאית',
      'חקלאית',
      'קרקע ומים',
      'lowdermilk',
      'agricultural',
    ],
  },
  {
    id: 'central_library',
    searchQuery: 'הספרייה המרכזית ע"ש אלישר טכניון חיפה',
    aliases: [
      'ספריה מרכזית',
      'הספריה המרכזית',
      'ספרייה מרכזית',
      'הספרייה המרכזית',
      'אלישר',
      'library',
      'elyachar',
    ],
  },
  {
    id: 'rappaport_medicine',
    searchQuery: 'הפקולטה לרפואה ע"ש רפפורט טכניון חיפה',
    aliases: [
      'רפפורט',
      'רפואה',
      'הפקולטה לרפואה',
      'פקולטה לרפואה',
      'בת גלים',
      'rappaport',
      'medicine',
    ],
  },
];

const NON_PHYSICAL_LOCATION_KEYWORDS = [
  'zoom',
  'זום',
  'מקוון',
  'אונליין',
  'online',
  'tba',
  'tbd',
  'n/a',
  'ללא',
  'אין',
  'לא נקבע',
  'טרם נקבע',
  'מרחוק',
  'הקלטה',
  'וידאו',
  'אסינכרוני',
  'moed',
  'מועד',
];

/**
 * Cleans a raw schedule location string by removing room numbers, floor numbers,
 * common room/hall prefixes, punctuation, and extra whitespace.
 * Examples:
 * - "אולמן 304" -> "אולמן"
 * - "טאוב 1" -> "טאוב"
 * - "פישבך - חדר 402" -> "פישבך"
 */
export function cleanBuildingName(locationString: string): string {
  let cleaned = locationString.trim();
  if (!cleaned) return '';

  // Remove parenthesized room/floor notes that are mostly digits
  cleaned = cleaned.replace(/\([^)]*\d+[^)]*\)/g, ' ');

  // Remove common room/hall/floor words followed by numbers or standing alone as qualifiers
  cleaned = cleaned
    .replace(/\b(room|hall|auditorium|bldg|building|floor|lab)\b\.?/gi, ' ')
    .replace(
      /(?:^|\s)(חדר|אולם|כיתה|קומה|מעבדה|בניין|בנין)(?=\s|$|[-:0-9])/g,
      ' '
    );

  // Strip numbers, dashes, slashes, colons, dots, commas
  cleaned = cleaned
    .replace(/[0-9]+/g, ' ')
    .replace(/[-–—/:.,#()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing single-letter room suffixes (e.g., "טאוב א" or "אולמן ב'")
  cleaned = cleaned
    .replace(/\s+[א-ת]'?$/g, '')
    .replace(/\s+[a-zA-Z]$/g, '')
    .trim();

  return cleaned;
}

/**
 * Returns a Google Maps search URL for a Technion building given a raw schedule location string,
 * or `null` if the location is empty or non-physical (e.g. Zoom/Online/TBA).
 */
export function getBuildingMapsUrl(
  locationString?: string | null
): string | null {
  if (!locationString || typeof locationString !== 'string') {
    return null;
  }

  const rawTrimmed = locationString.trim();
  if (!rawTrimmed || rawTrimmed === '-' || rawTrimmed === '—') {
    return null;
  }

  const lowerRaw = rawTrimmed.toLowerCase();

  // Ignore pure date strings (e.g., "14/02/2027") or non-physical keywords
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(rawTrimmed)) {
    return null;
  }
  for (const kw of NON_PHYSICAL_LOCATION_KEYWORDS) {
    if (lowerRaw === kw || lowerRaw.includes(kw)) {
      return null;
    }
  }

  const cleanedBuildingName = cleanBuildingName(rawTrimmed);
  // Ensure there is at least one Hebrew or Latin letter remaining
  if (
    !cleanedBuildingName ||
    !/[a-zA-Z\u0590-\u05FF]/.test(cleanedBuildingName)
  ) {
    return null;
  }

  const normalizedCleaned = cleanedBuildingName.toLowerCase();

  // 1. Check exact alias match first
  for (const bldg of TECHNION_BUILDINGS) {
    for (const alias of bldg.aliases) {
      if (normalizedCleaned === alias.toLowerCase()) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          bldg.searchQuery
        )}`;
      }
    }
  }

  // 2. Check partial / substring match (prioritizing longer aliases first so e.g. "הנדסה כימית" matches before "כימיה")
  const allAliases: { alias: string; searchQuery: string }[] = [];
  for (const bldg of TECHNION_BUILDINGS) {
    for (const alias of bldg.aliases) {
      allAliases.push({
        alias: alias.toLowerCase(),
        searchQuery: bldg.searchQuery,
      });
    }
  }
  allAliases.sort((a, b) => b.alias.length - a.alias.length);

  for (const item of allAliases) {
    if (
      normalizedCleaned.includes(item.alias) ||
      item.alias.includes(normalizedCleaned)
    ) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        item.searchQuery
      )}`;
    }
  }

  // 3. Fallback if not found in static dictionary
  const fallbackQuery = `${cleanedBuildingName} טכניון חיפה`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    fallbackQuery
  )}`;
}
