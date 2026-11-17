// src/services/webworkSync.ts
import { CourseCatalogItem, CourseTask, ScheduleEvent } from '../types/schedule';
import { matchCourseForMoodleTask } from './moodleSync';

// Webwork requires Technion Moodle SSO / LTI launch, so start at the Moodle dashboard
export const WEBWORK_LOGIN_URL = 'https://moodle.technion.ac.il/my/';

/**
 * Checks whether the current WebView URL has navigated to a Technion Webwork domain
 * (e.g., URLs containing "webwork.technion", "/webwork2", or "ww") and is not a login/SSO page.
 */
export function isWebworkAuthenticatedUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();

  // Exclude Moodle pages and SSO / login endpoints
  if (
    lower.includes('moodle.technion') ||
    lower.includes('login') ||
    lower.includes('oauth') ||
    lower.includes('saml') ||
    lower.includes('shibboleth') ||
    lower.includes('microsoftonline') ||
    lower.includes('adfs')
  ) {
    return false;
  }

  return (
    lower.includes('webwork.technion') ||
    lower.includes('/webwork2') ||
    /\bww\d*\.technion/i.test(lower) ||
    /:\/\/ww\d*\./i.test(lower) ||
    lower.includes('webwork')
  );
}

/**
 * Helper script injected while the user is browsing Moodle inside the Webwork WebView.
 * Ensures LTI / external Webwork links open in the top-level WebView window (rather than
 * a blocked popup or nested iframe) so navigation reaches the Webwork domain cleanly.
 */
export const WEBWORK_MOODLE_NAVIGATION_HELPER_SCRIPT = `
(function() {
  try {
    // 1. Ensure links and LTI forms with target="_blank" or contentframe open inside the same WebView
    var blankLinks = document.querySelectorAll('a[target="_blank"]');
    for (var i = 0; i < blankLinks.length; i++) {
      blankLinks[i].setAttribute('target', '_self');
    }

    var forms = document.querySelectorAll('form[target="_blank"], form[target="contentframe"]');
    for (var f = 0; f < forms.length; f++) {
      forms[f].setAttribute('target', '_self');
    }

    // 2. If the user opened a Moodle LTI wrapper page (mod/lti/view.php) that embeds
    //    the Webwork launch inside #contentframe, promote the launch URL to the top window
    var ltiIframe = document.querySelector('iframe#contentframe, iframe[src*="mod/lti/launch.php"], iframe[src*="webwork"]');
    if (ltiIframe && ltiIframe.src && !window.__meatSpoonPromotedLtiFrame) {
      window.__meatSpoonPromotedLtiFrame = true;
      window.location.href = ltiIframe.src;
    }
  } catch (e) {}
  return true;
})();
`;

/**
 * Injected JavaScript for Technion Webwork (`webwork.technion.ac.il/webwork2/...`).
 * Extracts open homework sets and their closing dates/times from the DOM
 * (or from linked course pages if on a multi-course dashboard) and posts them
 * back to React Native via `window.ReactNativeWebView.postMessage`.
 */
export const WEBWORK_INJECTED_SYNC_SCRIPT = `
(function() {
  if (window.__meatSpoonWebworkSyncRunning) return true;

  // Skip if a login password field is currently visible on the page
  var hasPasswordInput = !!document.querySelector('input[type="password"], input[name="passwd"], input[name="password"]');
  if (hasPasswordInput) {
    return true;
  }

  function parseOpenDueIso(text) {
    if (!text) return null;
    // Matches ".Open. Due 19.11.2026 @ 23:59" or "Open. Due DD.MM.YYYY @ HH:MM"
    var m = text.match(/Open[.,]?\\s*(?:Due|Closes)\\s*(\\d{1,2})[./-](\\d{1,2})[./-](\\d{2,4})\\s*(?:@|at|,|\\s)\\s*(\\d{1,2}):(\\d{2})/i);
    if (!m) return null;
    var day = parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    var year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    var hour = parseInt(m[4], 10);
    var minute = parseInt(m[5], 10);
    var d = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function cleanAssignmentTitle(raw) {
    if (!raw) return '';
    return raw
      .replace(/\\.?\\s*Open[.,]?\\s*(?:Due|Closes).*$/i, '')
      .replace(/^[\\s•·:.-]+|[\\s•·:.-]+$/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function findNearestTitleAndUrl(statusEl, pageUrl) {
    var foundTitle = '';
    var foundUrl = pageUrl;

    // 1. Traverse previousElementSibling chain on the same level
    var prev = statusEl.previousElementSibling;
    while (prev) {
      var anchor = prev.tagName === 'A' ? prev : prev.querySelector('a');
      if (anchor && cleanAssignmentTitle(anchor.textContent)) {
        foundTitle = cleanAssignmentTitle(anchor.textContent);
        if (anchor.href) foundUrl = anchor.href;
        return { title: foundTitle, url: foundUrl };
      }
      var prevText = cleanAssignmentTitle(prev.textContent || '');
      if (prevText && !/open\\s*assignments/i.test(prevText)) {
        foundTitle = prevText;
        return { title: foundTitle, url: foundUrl };
      }
      prev = prev.previousElementSibling;
    }

    // 2. Walk up to parent container (up to 4 levels) as long as it represents a single task item
    var curr = statusEl.parentElement;
    for (var depth = 0; depth < 4 && curr && curr !== document.body; depth++) {
      var currText = (curr.innerText || curr.textContent || '');
      var openMatches = currText.match(/Open[.,]?\\s*(?:Due|Closes)/gi);
      if (openMatches && openMatches.length > 1) {
        // Reached a list container holding multiple tasks; check previous sibling of the child we came from
        break;
      }

      var linkInContainer = curr.querySelector('a');
      if (linkInContainer && cleanAssignmentTitle(linkInContainer.textContent)) {
        foundTitle = cleanAssignmentTitle(linkInContainer.textContent);
        if (linkInContainer.href) foundUrl = linkInContainer.href;
        return { title: foundTitle, url: foundUrl };
      }

      // Also check previous siblings of the parent element itself
      var parentPrev = curr.previousElementSibling;
      while (parentPrev) {
        var pAnchor = parentPrev.tagName === 'A' ? parentPrev : parentPrev.querySelector('a');
        if (pAnchor && cleanAssignmentTitle(pAnchor.textContent)) {
          var pText = (parentPrev.innerText || parentPrev.textContent || '');
          if (!/Open[.,]?\\s*(?:Due|Closes)/i.test(pText)) {
            foundTitle = cleanAssignmentTitle(pAnchor.textContent);
            if (pAnchor.href) foundUrl = pAnchor.href;
            return { title: foundTitle, url: foundUrl };
          }
        }
        parentPrev = parentPrev.previousElementSibling;
      }

      // Or extract text before ".Open. Due" inside the single-item container
      var beforeOpen = cleanAssignmentTitle(currText.split(/\\.?\\s*Open[.,]?\\s*(?:Due|Closes)/i)[0] || '');
      if (beforeOpen && !/open\\s*assignments/i.test(beforeOpen) && beforeOpen.length < 120) {
        foundTitle = beforeOpen;
        return { title: foundTitle, url: foundUrl };
      }

      curr = curr.parentElement;
    }

    // 3. Fallback: text before ".Open. Due" inside statusEl itself
    var selfText = (statusEl.innerText || statusEl.textContent || '');
    var selfBefore = cleanAssignmentTitle(selfText.split(/\\.?\\s*Open[.,]?\\s*(?:Due|Closes)/i)[0] || '');
    if (selfBefore) {
      foundTitle = selfBefore;
    }

    return { title: foundTitle, url: foundUrl };
  }

  function extractSetsFromDocument(doc, pageUrl) {
    var results = [];
    var seen = {};
    var pageTitle =
      (doc.title || '') +
      ' ' +
      ((doc.querySelector('h1, h2, .page-title, #page-title, .breadcrumb, .course-title') || {}).textContent || '');
    var urlCourseMatch = pageUrl.match(/\\/webwork2\\/([^/?#]+)/i);
    var courseCodeFromUrl = urlCourseMatch ? decodeURIComponent(urlCourseMatch[1]) : '';
    var courseHint = (courseCodeFromUrl + ' ' + pageTitle).replace(/\\s+/g, ' ').trim();

    // Strategy 1: Technion Webwork Responsive Accordion Layout ("Open Assignments" -> ".Open. Due DD.MM.YYYY @ HH:MM")
    var allElements = Array.prototype.slice.call(doc.querySelectorAll('*'));
    for (var idx = 0; idx < allElements.length; idx++) {
      var el = allElements[idx];
      if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'BODY' || el.tagName === 'HTML') {
        continue;
      }

      var elText = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!elText || !/Open[.,]?\\s*(?:Due|Closes)/i.test(elText)) {
        continue;
      }

      // Skip outer wrapper elements if one of their child elements already contains the "Open. Due" string
      var childHasOpenDue = false;
      for (var c = 0; c < el.children.length; c++) {
        var childText = (el.children[c].innerText || el.children[c].textContent || '');
        if (/Open[.,]?\\s*(?:Due|Closes)\\s*\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}/i.test(childText)) {
          childHasOpenDue = true;
          break;
        }
      }
      if (childHasOpenDue) continue;

      var iso = parseOpenDueIso(elText);
      if (!iso) continue;

      var titleAndUrl = findNearestTitleAndUrl(el, pageUrl);
      var setName = titleAndUrl.title;
      if (!setName || setName.toLowerCase() === 'open assignments') continue;

      var statusMatch = elText.match(/\\.?\\s*Open[.,]?\\s*(?:Due|Closes)\\s*\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}\\s*(?:@|at|,|\\s)\\s*\\d{1,2}:\\d{2}/i);
      var cleanStatus = statusMatch ? statusMatch[0].trim() : elText;

      var dedupeKey = setName.toLowerCase() + '__' + iso;
      if (seen[dedupeKey]) continue;
      seen[dedupeKey] = true;

      results.push({
        setName: setName.replace(/_/g, ' '),
        deadlineISO: iso,
        statusText: cleanStatus,
        courseHint: courseHint,
        url: titleAndUrl.url
      });
    }

    if (results.length > 0) {
      return results;
    }

    // Strategy 2: Classic Webwork Table Fallback
    var rows = Array.prototype.slice.call(
      doc.querySelectorAll('table.problem_set_table tr, #set-list-container tr, table.set_table tr, table tr')
    );

    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var rowText = (tr.innerText || tr.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!rowText) continue;

      var isClosed = /\\bclosed\\b|נסגר בתאריך|סגור/i.test(rowText) && !/open|פתוח/i.test(rowText);
      if (isClosed) continue;

      var hasDatePattern =
        /(\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4})/.test(rowText) ||
        /(\\d{4}-\\d{2}-\\d{2})/.test(rowText);
      if (!hasDatePattern) continue;

      var linkEl = tr.querySelector('a[href*="webwork2"], a');
      var cells = tr.querySelectorAll('td');
      var fallbackName = '';
      var fallbackUrl = pageUrl;

      if (linkEl && (linkEl.textContent || '').trim()) {
        fallbackName = (linkEl.textContent || '').trim();
        if (linkEl.href) fallbackUrl = linkEl.href;
      } else if (cells.length > 0) {
        fallbackName = (cells[0].textContent || '').trim();
        if (cells.length > 1 && (!fallbackName || fallbackName.length < 2)) {
          fallbackName = (cells[1].textContent || '').trim();
        }
      }

      if (!fallbackName || fallbackName.toLowerCase() === 'name' || fallbackName.toLowerCase() === 'set name') {
        continue;
      }

      results.push({
        setName: fallbackName.replace(/_/g, ' '),
        deadlineISO: parseOpenDueIso(rowText) || undefined,
        statusText: rowText,
        courseHint: courseHint,
        url: fallbackUrl
      });
    }

    return results;
  }

  function postTasksToApp(sets, isManual) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'WEBWORK_TASKS_DATA',
        tasks: sets,
        manual: !!isManual,
        sourceUrl: window.location.href
      }));
    }
  }

  var immediateSets = extractSetsFromDocument(document, window.location.href);
  if (immediateSets.length > 0) {
    window.__meatSpoonWebworkSyncRunning = true;
    window.__meatSpoonForceWebworkScan = false;
    postTasksToApp(immediateSets, false);
    return true;
  }

  // If accordion items are rendered asynchronously after initial DOM load, poll briefly
  if (!window.__meatSpoonWebworkPollStarted) {
    window.__meatSpoonWebworkPollStarted = true;
    var attempts = 0;
    var pollId = setInterval(function() {
      attempts++;
      if (window.__meatSpoonWebworkSyncRunning || attempts > 12) {
        clearInterval(pollId);
        window.__meatSpoonWebworkPollStarted = false;
        return;
      }
      var polledSets = extractSetsFromDocument(document, window.location.href);
      if (polledSets.length > 0) {
        clearInterval(pollId);
        window.__meatSpoonWebworkSyncRunning = true;
        window.__meatSpoonForceWebworkScan = false;
        postTasksToApp(polledSets, false);
      }
    }, 700);
  }

  // If on a logged-in Webwork course-selection page with links to /webwork2/<course>/,
  // crawl linked course pages when requested or when on the root /webwork2/ index
  var courseLinks = Array.prototype.slice.call(document.querySelectorAll('a[href*="/webwork2/"]'));
  if (window.__meatSpoonForceWebworkScan || courseLinks.length > 0) {
    var isManual = !!window.__meatSpoonForceWebworkScan;
    window.__meatSpoonWebworkSyncRunning = true;
    (async function() {
      var allExtracted = [];
      var visited = {};
      for (var j = 0; j < courseLinks.length && j < 12; j++) {
        var href = courseLinks[j].href;
        if (!href || visited[href] || href === window.location.href) continue;
        if (/logout|options|grades|Achievements/i.test(href)) continue;
        visited[href] = true;
        try {
          var resp = await fetch(href, { method: 'GET', credentials: 'include' });
          if (resp.ok) {
            var html = await resp.text();
            var parser = new DOMParser();
            var subDoc = parser.parseFromString(html, 'text/html');
            var subSets = extractSetsFromDocument(subDoc, href);
            for (var k = 0; k < subSets.length; k++) {
              allExtracted.push(subSets[k]);
            }
          }
        } catch (e) {}
      }

      if (allExtracted.length > 0 || isManual) {
        postTasksToApp(allExtracted, isManual);
      } else if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'WEBWORK_NO_TASKS_YET',
          sourceUrl: window.location.href
        }));
      }
      window.__meatSpoonWebworkSyncRunning = false;
      window.__meatSpoonForceWebworkScan = false;
    })();
  }

  return true;
})();
`;

interface RawWebworkSet {
  setName: string;
  deadlineISO?: string;
  statusText: string;
  courseHint: string;
  url?: string;
}

/**
 * Parses the JSON message returned from the Webwork WebView into `CourseTask[]`.
 */
export function parseWebworkSyncPayload(
  rawMessage: string,
  events: ScheduleEvent[],
  catalog: CourseCatalogItem[]
): CourseTask[] {
  let parsed: any;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return [];
  }

  if (!parsed || parsed.type !== 'WEBWORK_TASKS_DATA' || !Array.isArray(parsed.tasks)) {
    return [];
  }

  const results: CourseTask[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < parsed.tasks.length; i++) {
    const rawItem = parsed.tasks[i] as RawWebworkSet;
    const setName = String(rawItem?.setName || '').trim();
    const statusText = String(rawItem?.statusText || '').trim();
    if (!setName) continue;

    let deadlineDate: Date | null = null;
    if (rawItem.deadlineISO) {
      const parsedIso = new Date(rawItem.deadlineISO);
      if (!isNaN(parsedIso.getTime())) {
        deadlineDate = parsedIso;
      }
    }
    if (!deadlineDate && statusText) {
      deadlineDate = parseWebworkDeadline(statusText);
    }
    if (!deadlineDate) continue;

    const matched = matchCourseForMoodleTask(
      `${rawItem.courseHint || ''} ${setName}`,
      events,
      catalog,
      'Webwork Assignments (מטלות וובוורק)',
      'custom:webwork-synced'
    );

    const dedupeKey = `${matched.relationKey}__${setName.toLowerCase()}__${Math.floor(
      deadlineDate.getTime() / 60000
    )}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    results.push({
      id: `webwork-task-${Date.now()}-${i}`,
      relationKey: matched.relationKey,
      courseId: matched.courseId,
      courseTitle: matched.courseTitle,
      groupTitle: matched.courseTitle,
      title: `Webwork: ${setName}`,
      deadlineISO: deadlineDate.toISOString(),
      description: statusText,
      url: rawItem.url || WEBWORK_LOGIN_URL,
      source: 'Webwork',
      createdAtISO: new Date().toISOString(),
    });
  }

  return results;
}

/**
 * Extracts a Date from Webwork's status column string, e.g.:
 * - "Open, closes 12/25/2026 at 11:59pm IDT"
 * - "Open, closes 25/12/2026 at 23:59"
 * - "2026-12-25 23:59"
 */
function parseWebworkDeadline(text: string): Date | null {
  // 1. Check YYYY-MM-DD
  const ymdMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const timeMatch = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);

  let hours = 23;
  let minutes = 59;
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const ampm = (timeMatch[3] || '').toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    hours = h;
    minutes = m;
  }

  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  }

  // 2. Check MM/DD/YYYY or DD/MM/YYYY or DD.MM.YYYY
  const slashMatch = text.match(/\b(\d{1,2})([./-])(\d{1,2})\2(\d{2,4})\b/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const sep = slashMatch[2];
    const p2 = parseInt(slashMatch[3], 10);
    let year = parseInt(slashMatch[4], 10);
    if (year < 100) year += 2000;

    // Dot separator (DD.MM.YYYY @ HH:MM) at Technion Webwork is always DD.MM.YYYY.
    // Slash separator in English defaults to MM/DD/YYYY unless p1 > 12 (then DD/MM/YYYY).
    let month: number;
    let day: number;
    if (sep === '.') {
      day = p1;
      month = p2;
    } else if (p1 > 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12) {
      month = p1;
      day = p2;
    } else if (/\b(am|pm|closes)\b/i.test(text)) {
      month = p1;
      day = p2;
    } else {
      day = p1;
      month = p2;
    }

    const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

export interface WebworkCourseOverride {
  relationKey: string;
  courseId?: string;
  courseTitle: string;
}

function cleanWebworkTitleText(raw: string): string {
  return raw
    .replace(/\.?\s*Open[.,]?\s*(?:Due|Closes).*$/i, '')
    .replace(/^[\s•·:.-]+|[\s•·:.-]+$/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses WebWork assignments for Web/PWA from:
 * 1. JSON payload (`WEBWORK_TASKS_DATA`)
 * 2. Copied plain text from Technion WebWork responsive accordion layout
 *    (e.g., "Open Assignments", "HW02-Complex", ".Open. Due 19.11.2026 @ 23:59")
 * 3. Copied classic WebWork table rows ("Set01 Open, closes 12/25/2026 at 11:59pm")
 */
export function parseWebworkTextInput(
  rawInput: string,
  events: ScheduleEvent[],
  catalog: CourseCatalogItem[],
  courseOverride?: WebworkCourseOverride | null
): CourseTask[] {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return [];

  const applyCourseOverride = (items: CourseTask[]): CourseTask[] => {
    if (!courseOverride) return items;
    return items.map((t) => ({
      ...t,
      relationKey: courseOverride.relationKey,
      courseId: courseOverride.courseId,
      courseTitle: courseOverride.courseTitle,
      groupTitle: courseOverride.courseTitle,
    }));
  };

  if (trimmed.startsWith('{')) {
    const fromJson = parseWebworkSyncPayload(trimmed, events, catalog);
    if (fromJson.length > 0) return applyCourseOverride(fromJson);
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const extractedSets: RawWebworkSet[] = [];
  const headerContext: string[] = [];
  let inClosedSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Stop or skip if inside the Closed Assignments section
    if (/^closed\s+assignments/i.test(line) || /^past\s+assignments/i.test(line)) {
      inClosedSection = true;
      continue;
    }
    if (/^open\s+assignments/i.test(line)) {
      inClosedSection = false;
      continue;
    }

    if (i < 12) {
      headerContext.push(line);
    }

    const hasOpenDuePattern =
      /Open[.,]?\s*(?:Due|Closes)/i.test(line) ||
      (!inClosedSection && /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/.test(line) && !/\bclosed\b|סגור|נסגר/i.test(line));

    if (!hasOpenDuePattern) continue;

    // Look for date/time on this line, or combine with the next line if copied split across lines
    let statusLine = line;
    if (!/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}-\d{1,2}-\d{1,2}\b/.test(statusLine) && i + 1 < lines.length) {
      statusLine = `${statusLine} ${lines[i + 1]}`;
    }

    const deadlineDate = parseWebworkDeadline(statusLine);
    if (!deadlineDate) continue;

    // Assignment title can appear before ".Open. Due" on the same line OR on the immediately preceding line
    let setName = cleanWebworkTitleText(
      line.split(/\.?\s*(?:Open[.,]?\s*(?:Due|Closes)|\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b)/i)[0] || ''
    );

    if (
      (!setName || /^(open\s+assignments|due|closes)$/i.test(setName)) &&
      i > 0
    ) {
      const prevLine = lines[i - 1];
      if (
        prevLine &&
        !/^open\s+assignments/i.test(prevLine) &&
        !/^closed\s+assignments/i.test(prevLine) &&
        !/Open[.,]?\s*(?:Due|Closes)/i.test(prevLine)
      ) {
        setName = cleanWebworkTitleText(prevLine);
      }
    }

    if (!setName || /^(name|set name|open assignments|status)$/i.test(setName)) {
      continue;
    }

    extractedSets.push({
      setName,
      deadlineISO: deadlineDate.toISOString(),
      statusText: statusLine,
      courseHint: headerContext.join(' '),
      url: WEBWORK_LOGIN_URL,
    });
  }

  const syntheticPayload = JSON.stringify({
    type: 'WEBWORK_TASKS_DATA',
    tasks: extractedSets,
  });
  return applyCourseOverride(
    parseWebworkSyncPayload(syntheticPayload, events, catalog)
  );
}
