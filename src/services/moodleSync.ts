// src/services/moodleSync.ts
import { CourseCatalogItem, CourseTask, ScheduleEvent } from '../types/schedule';

export const MOODLE_LOGIN_URL = 'https://moodle.technion.ac.il/my/';
export const MOODLE_CALENDAR_EXPORT_PAGE_URL =
  'https://moodle.technion.ac.il/calendar/export.php';
export const MOODLE_CALENDAR_EXPORT_URL =
  'https://moodle.technion.ac.il/calendar/export_execute.php?preset_what=all&preset_time=recentupcoming';

/**
 * Detects whether a WebView URL indicates a redirect to the Moodle login page
 * or institutional SSO page (meaning the session cookie is missing or expired).
 */
export function isMoodleLoginRedirectUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (!lower.startsWith('http')) return false;

  // Redirected outside moodle.technion.ac.il (e.g. Microsoft Entra / Technion SSO)
  const isMoodleHost =
    lower.includes('moodle') && lower.includes('technion.ac.il');
  if (!isMoodleHost) {
    return true;
  }

  return (
    lower.includes('/login/') ||
    lower.includes('login/index.php') ||
    lower.includes('/auth/') ||
    lower.includes('oauth') ||
    lower.includes('saml') ||
    lower.includes('enrol/index.php')
  );
}

/**
 * Determines whether a WebView URL indicates the user has completed login
 * and arrived at the authenticated Technion Moodle dashboard or homepage.
 */
export function isMoodleAuthenticatedUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();

  // Must be on a Technion Moodle host (and not on Microsoft / Technion SSO login pages)
  const isMoodleHost =
    lower.includes('moodle') && lower.includes('technion.ac.il');
  if (!isMoodleHost) return false;

  // Exclude login, auth, and SSO callback pages
  if (
    lower.includes('login') ||
    lower.includes('/auth/') ||
    lower.includes('oauth') ||
    lower.includes('saml') ||
    lower.includes('microsoftonline') ||
    lower.includes('adfs') ||
    lower.includes('idp')
  ) {
    return false;
  }

  // Match dashboard (/my/), homepage (/ or /index.php), course pages, or calendar pages
  const parsedPath = lower.replace(/^https?:\/\/[^/]+/, '');
  return (
    parsedPath === '' ||
    parsedPath === '/' ||
    parsedPath.startsWith('/my') ||
    parsedPath.startsWith('/?redirect=0') ||
    parsedPath.startsWith('/index.php') ||
    parsedPath.startsWith('/course/') ||
    parsedPath.startsWith('/calendar/')
  );
}

/**
 * JavaScript snippet injected into the Moodle WebView after navigation finishes.
 * Strictly verifies that the user is genuinely authenticated (not on a login page
 * or unauthenticated guest homepage) before extracting calendar tasks.
 * If the user is not logged in, it does nothing and leaves the WebView open for login.
 */
export const MOODLE_INJECTED_SYNC_SCRIPT = `
(function() {
  if (window.__meatSpoonMoodleSyncRunning) return true;

  function postToNative(payloadObj) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payloadObj));
    }
  }

  var href = (window.location && window.location.href ? window.location.href : '').toLowerCase();

  // 1. Check URL for any login / SSO / authentication path
  var isLoginUrl =
    href.indexOf('login') !== -1 ||
    href.indexOf('/auth/') !== -1 ||
    href.indexOf('oauth') !== -1 ||
    href.indexOf('saml') !== -1 ||
    href.indexOf('microsoftonline') !== -1 ||
    href.indexOf('adfs') !== -1;

  // 2. Check DOM for unauthenticated or login UI elements
  // Note: On Moodle, unauthenticated pages still have .usermenu and M.cfg.sesskey,
  // so we must explicitly check for login links/buttons, body.notloggedin, and logout link!
  var bodyEl = document.body;
  var isBodyNotLoggedIn =
    !bodyEl ||
    bodyEl.classList.contains('notloggedin') ||
    bodyEl.classList.contains('pagelayout-login');

  var hasLoginUiInDom = !!document.querySelector(
    'form#login, input[name="password"], .loginform, .logininfo a[href*="login/index.php"], .usermenu .login, [data-region="usermenu"] .login, [data-region="usermenu"] a[href*="login/index.php"]'
  );

  // 3. Check positive authenticated student markers (Moodle guest is userid 1, unauthenticated is 0)
  var moodleUserId =
    window.M && window.M.cfg && window.M.cfg.userid
      ? Number(window.M.cfg.userid)
      : 0;
  var hasLogoutLink = !!document.querySelector('a[href*="login/logout.php"]');
  var isGenuinelyAuthenticated =
    !isLoginUrl &&
    !isBodyNotLoggedIn &&
    !hasLoginUiInDom &&
    (moodleUserId > 1 || hasLogoutLink);

  if (!isGenuinelyAuthenticated) {
    if (window.__meatSpoonManualMoodleSync) {
      window.__meatSpoonManualMoodleSync = false;
      postToNative({
        type: 'MOODLE_MANUAL_SYNC_NOT_LOGGED_IN'
      });
    } else {
      postToNative({
        type: 'MOODLE_NOT_LOGGED_IN'
      });
    }
    return true;
  }

  window.__meatSpoonManualMoodleSync = false;
  window.__meatSpoonMoodleSyncRunning = true;
  postToNative({ type: 'MOODLE_SYNC_STARTED' });

  async function runMoodleCalendarFetch() {
    var origin = window.location.origin;
    var icsText = '';
    var ajaxEvents = [];
    var ajaxAuthenticatedOk = false;

    // 1. Direct fetch to Moodle's calendar export endpoint using active session cookies
    try {
      var directExportUrl = origin + '/calendar/export_execute.php?preset_what=all&preset_time=recentupcoming';
      var directResp = await fetch(directExportUrl, {
        method: 'GET',
        credentials: 'include'
      });
      if (directResp.ok && (!directResp.url || directResp.url.toLowerCase().indexOf('login') === -1)) {
        var text = await directResp.text();
        if (text && text.indexOf('BEGIN:VCALENDAR') !== -1) {
          icsText = text;
        }
      }
    } catch (e) {}

    // 2. If direct export_execute needed authtoken/userid, discover it from /calendar/export.php
    if (!icsText) {
      try {
        var exportPageResp = await fetch(origin + '/calendar/export.php', {
          method: 'GET',
          credentials: 'include'
        });
        if (exportPageResp.ok && (!exportPageResp.url || exportPageResp.url.toLowerCase().indexOf('login') === -1)) {
          var exportHtml = await exportPageResp.text();
          if (exportHtml.indexOf('login/index.php') === -1 && exportHtml.indexOf('notloggedin') === -1) {
            var urlMatch = exportHtml.match(/https?:\\/\\/[^"'\\s<>]+export_execute\\.php\\?[^"'\\s<>]+/i);
            if (urlMatch && urlMatch[0]) {
              var tokenUrl = urlMatch[0].replace(/&amp;/g, '&');
              var tokenResp = await fetch(tokenUrl, {
                method: 'GET',
                credentials: 'include'
              });
              if (tokenResp.ok) {
                var tokenIcs = await tokenResp.text();
                if (tokenIcs && tokenIcs.indexOf('BEGIN:VCALENDAR') !== -1) {
                  icsText = tokenIcs;
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    // 3. Also query Moodle's JSON Calendar Action Events API via active session & sesskey
    try {
      var sesskey = window.M && window.M.cfg && window.M.cfg.sesskey;
      if (sesskey) {
        var nowSec = Math.floor(Date.now() / 1000) - 86400;
        var ajaxUrl = origin + '/lib/ajax/service.php?sesskey=' + encodeURIComponent(sesskey) + '&info=core_calendar_get_action_events_by_timesort';
        var ajaxResp = await fetch(ajaxUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{
            index: 0,
            methodname: 'core_calendar_get_action_events_by_timesort',
            args: {
              timesortfrom: nowSec,
              limitnum: 50
            }
          }])
        });
        if (ajaxResp.ok) {
          var ajaxJson = await ajaxResp.json();
          if (Array.isArray(ajaxJson) && ajaxJson[0] && !ajaxJson[0].error && ajaxJson[0].data && Array.isArray(ajaxJson[0].data.events)) {
            ajaxAuthenticatedOk = true;
            ajaxEvents = ajaxJson[0].data.events;
          }
        }
      }
    } catch (e) {}

    // If neither iCal export nor authenticated AJAX succeeded, do not close the modal prematurely
    if (!icsText && !ajaxAuthenticatedOk) {
      window.__meatSpoonMoodleSyncRunning = false;
      postToNative({ type: 'MOODLE_NOT_LOGGED_IN' });
      return;
    }

    postToNative({
      type: 'MOODLE_CALENDAR_DATA',
      icsText: icsText,
      ajaxEvents: ajaxEvents,
      sourceUrl: window.location.href
    });
  }

  runMoodleCalendarFetch().catch(function(err) {
    window.__meatSpoonMoodleSyncRunning = false;
    postToNative({
      type: 'MOODLE_SYNC_ERROR',
      message: err && err.message ? err.message : 'Failed to fetch Moodle calendar.'
    });
  });

  return true;
})();
`;

/**
 * Injected script for the silent background WebView that loads on app mount
 * at MOODLE_CALENDAR_EXPORT_URL.
 * - If redirected to login or session cookie is expired, posts `MOODLE_BG_AUTH_EXPIRED`.
 * - If session cookie is valid, fetches the latest calendar tasks and posts `MOODLE_CALENDAR_DATA`.
 */
export const MOODLE_BG_INJECTED_SYNC_SCRIPT = `
(function() {
  if (window.__meatSpoonBgMoodleSyncDone) return true;
  window.__meatSpoonBgMoodleSyncDone = true;

  function postToApp(obj) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }

  var href = (window.location && window.location.href ? window.location.href : '').toLowerCase();
  var bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';

  // 1. If the endpoint directly returned raw iCal (.ics) content in the response body
  if (bodyText.indexOf('BEGIN:VCALENDAR') !== -1) {
    postToApp({
      type: 'MOODLE_CALENDAR_DATA',
      icsText: bodyText,
      ajaxEvents: [],
      sourceUrl: window.location.href
    });
    return true;
  }

  // 2. Check if redirected to login page or showing login form / guest prompt
  var isLoginUrl =
    href.indexOf('login') !== -1 ||
    href.indexOf('/auth/') !== -1 ||
    href.indexOf('microsoftonline') !== -1 ||
    href.indexOf('oauth') !== -1 ||
    href.indexOf('saml') !== -1;

  var isBodyNotLoggedIn =
    !document.body ||
    document.body.classList.contains('notloggedin') ||
    document.body.classList.contains('pagelayout-login');

  var isLoginFormPresent = !!document.querySelector(
    'form#login, input[name="password"], .loginform, a[href*="login/index.php"], .usermenu .login'
  );
  var moodleUserId =
    window.M && window.M.cfg && window.M.cfg.userid
      ? Number(window.M.cfg.userid)
      : 0;
  var hasLoggedInMarkers =
    !isBodyNotLoggedIn &&
    !isLoginFormPresent &&
    (moodleUserId > 1 || !!document.querySelector('a[href*="login/logout.php"]'));

  if (isLoginUrl || !hasLoggedInMarkers) {
    postToApp({ type: 'MOODLE_BG_AUTH_EXPIRED' });
    return true;
  }

  async function runSilentFetch() {
    var origin = 'https://moodle.technion.ac.il';
    var icsText = '';
    var ajaxEvents = [];
    var redirectedToLogin = false;

    // Step A: Try direct calendar export_execute endpoint
    try {
      var directResp = await fetch(
        origin + '/calendar/export_execute.php?preset_what=all&preset_time=recentupcoming',
        { method: 'GET', credentials: 'include' }
      );
      if (directResp.url && directResp.url.toLowerCase().indexOf('/login') !== -1) {
        redirectedToLogin = true;
      } else if (directResp.ok) {
        var text = await directResp.text();
        if (text && text.indexOf('BEGIN:VCALENDAR') !== -1) {
          icsText = text;
        } else if (text && (text.indexOf('loginform') !== -1 || text.indexOf('login/index.php') !== -1)) {
          redirectedToLogin = true;
        }
      }
    } catch (e) {}

    // Step B: Discover tokenized export URL from /calendar/export.php if needed
    if (!icsText && !redirectedToLogin) {
      try {
        var exportPageResp = await fetch(origin + '/calendar/export.php', {
          method: 'GET',
          credentials: 'include'
        });
        if (exportPageResp.url && exportPageResp.url.toLowerCase().indexOf('/login') !== -1) {
          redirectedToLogin = true;
        } else if (exportPageResp.ok) {
          var exportHtml = await exportPageResp.text();
          if (exportHtml.indexOf('loginform') !== -1 && exportHtml.indexOf('logout.php') === -1) {
            redirectedToLogin = true;
          } else {
            var urlMatch = exportHtml.match(/https?:\\/\\/[^"'\\s<>]+export_execute\\.php\\?[^"'\\s<>]+/i);
            if (urlMatch && urlMatch[0]) {
              var tokenUrl = urlMatch[0].replace(/&amp;/g, '&');
              var tokenResp = await fetch(tokenUrl, {
                method: 'GET',
                credentials: 'include'
              });
              if (tokenResp.ok) {
                var tokenIcs = await tokenResp.text();
                if (tokenIcs && tokenIcs.indexOf('BEGIN:VCALENDAR') !== -1) {
                  icsText = tokenIcs;
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    // Step C: Try Moodle AJAX action events API if sesskey is available
    try {
      var sesskey = window.M && window.M.cfg && window.M.cfg.sesskey;
      if (sesskey && !redirectedToLogin) {
        var nowSec = Math.floor(Date.now() / 1000) - 86400;
        var ajaxUrl =
          origin +
          '/lib/ajax/service.php?sesskey=' +
          encodeURIComponent(sesskey) +
          '&info=core_calendar_get_action_events_by_timesort';
        var ajaxResp = await fetch(ajaxUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              index: 0,
              methodname: 'core_calendar_get_action_events_by_timesort',
              args: { timesortfrom: nowSec, limitnum: 50 }
            }
          ])
        });
        if (ajaxResp.ok) {
          var ajaxJson = await ajaxResp.json();
          if (
            Array.isArray(ajaxJson) &&
            ajaxJson[0] &&
            !ajaxJson[0].error &&
            ajaxJson[0].data &&
            Array.isArray(ajaxJson[0].data.events)
          ) {
            ajaxEvents = ajaxJson[0].data.events;
          } else if (Array.isArray(ajaxJson) && ajaxJson[0] && ajaxJson[0].error) {
            if (!icsText) redirectedToLogin = true;
          }
        }
      }
    } catch (e) {}

    if (redirectedToLogin || (!icsText && ajaxEvents.length === 0 && !hasLoggedInMarkers)) {
      postToApp({ type: 'MOODLE_BG_AUTH_EXPIRED' });
      return;
    }

    postToApp({
      type: 'MOODLE_CALENDAR_DATA',
      icsText: icsText,
      ajaxEvents: ajaxEvents,
      sourceUrl: window.location.href
    });
  }

  runSilentFetch().catch(function() {
    postToApp({ type: 'MOODLE_BG_AUTH_EXPIRED' });
  });

  return true;
})();
`;

interface RawMoodleTaskCandidate {
  uid: string;
  title: string;
  courseHint: string;
  deadlineDate: Date;
  description?: string;
  url?: string;
}

/**
 * Parses the message sent from the WebView (`icsText` and/or `ajaxEvents`)
 * into `CourseTask[]` linked to the user's tracked courses.
 */
export function parseMoodleSyncPayload(
  rawMessage: string,
  events: ScheduleEvent[],
  catalog: CourseCatalogItem[]
): CourseTask[] {
  let data: any;
  try {
    data = JSON.parse(rawMessage);
  } catch {
    // If rawMessage is plain iCal text directly
    if (rawMessage.includes('BEGIN:VCALENDAR')) {
      data = { type: 'MOODLE_CALENDAR_DATA', icsText: rawMessage, ajaxEvents: [] };
    } else {
      return [];
    }
  }

  if (!data || data.type === 'MOODLE_SYNC_ERROR') {
    return [];
  }

  const candidates: RawMoodleTaskCandidate[] = [];
  const seenKeys = new Set<string>();

  // 1. Parse iCal (.ics) VEVENT blocks from /calendar/export_execute.php
  if (typeof data.icsText === 'string' && data.icsText.includes('BEGIN:VEVENT')) {
    const icsCandidates = parseIcsEvents(data.icsText);
    for (const c of icsCandidates) {
      const dedupeKey = `${c.title.toLowerCase()}__${Math.floor(
        c.deadlineDate.getTime() / 60000
      )}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        candidates.push(c);
      }
    }
  }

  // 2. Parse Moodle JSON action events
  if (Array.isArray(data.ajaxEvents)) {
    for (const ev of data.ajaxEvents) {
      const rawTitle = String(ev?.name || ev?.activityname || '').trim();
      const timeSec = Number(ev?.timesort || ev?.timestart || 0);
      if (!rawTitle || !timeSec) continue;

      const deadlineDate = new Date(timeSec * 1000);
      if (isNaN(deadlineDate.getTime())) continue;

      const courseFullName = String(
        ev?.course?.fullname || ev?.course?.shortname || ev?.course?.idnumber || ''
      ).trim();

      const rawDesc = String(ev?.description || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const eventUrl = String(ev?.url || ev?.action?.url || '').trim();

      const dedupeKey = `${rawTitle.toLowerCase()}__${Math.floor(
        deadlineDate.getTime() / 60000
      )}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        candidates.push({
          uid: String(ev?.id || `ajax-${timeSec}`),
          title: cleanMoodleTaskTitle(rawTitle),
          courseHint: `${courseFullName} ${rawTitle}`,
          deadlineDate,
          description: rawDesc || (courseFullName ? `Course: ${courseFullName}` : undefined),
          url: eventUrl || undefined,
        });
      }
    }
  }

  // Map candidates to CourseTask items linked to existing courses (or a Moodle course group)
  return candidates.map((cand, idx) => {
    const matched = matchCourseForMoodleTask(cand.courseHint, events, catalog);
    return {
      id: `moodle-task-${cand.uid}-${idx}`,
      relationKey: matched.relationKey,
      courseId: matched.courseId,
      courseTitle: matched.courseTitle,
      groupTitle: matched.courseTitle,
      title: cand.title,
      deadlineISO: cand.deadlineDate.toISOString(),
      description: cand.description,
      url: cand.url,
      source: 'Moodle',
      createdAtISO: new Date().toISOString(),
    };
  });
}

/**
 * Unfolds RFC 5545 multi-line iCal fields and parses VEVENT blocks.
 */
function parseIcsEvents(icsText: string): RawMoodleTaskCandidate[] {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  const veventBlocks = unfolded.split('BEGIN:VEVENT').slice(1);
  const results: RawMoodleTaskCandidate[] = [];

  for (const rawBlock of veventBlocks) {
    const block = rawBlock.split('END:VEVENT')[0] || '';
    const lines = block.split(/\r?\n/);

    let uid = '';
    let summary = '';
    let categories = '';
    let description = '';
    let url = '';
    let dtEnd = '';
    let dtStart = '';

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const rawProp = line.slice(0, colonIdx).toUpperCase();
      const propName = rawProp.split(';')[0];
      const val = unescapeIcsValue(line.slice(colonIdx + 1).trim());

      if (propName === 'UID') uid = val;
      else if (propName === 'SUMMARY') summary = val;
      else if (propName === 'CATEGORIES') categories = val;
      else if (propName === 'DESCRIPTION') description = val;
      else if (propName === 'URL') url = val;
      else if (propName === 'DTEND') dtEnd = val;
      else if (propName === 'DTSTART') dtStart = val;
    }

    if (!summary) continue;
    const rawDateStr = dtStart || dtEnd;
    const deadlineDate = parseIcsDate(rawDateStr);
    if (!deadlineDate) continue;

    results.push({
      uid: uid || `${summary}-${deadlineDate.getTime()}`,
      title: cleanMoodleTaskTitle(summary),
      courseHint: `${categories} ${summary} ${description}`,
      deadlineDate,
      description: description || (categories ? `Course: ${categories}` : undefined),
      url: url || undefined,
    });
  }

  return results;
}

function unescapeIcsValue(val: string): string {
  return val
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function cleanMoodleTaskTitle(rawSummary: string): string {
  return rawSummary
    .replace(/\s+is due$/i, '')
    .replace(/^יש להגיש את\s+/i, '')
    .trim();
}

/**
 * Parses an iCal timestamp such as "20261220T215900Z" or "20261220T235900" or "20261220".
 */
function parseIcsDate(icsDateStr: string): Date | null {
  if (!icsDateStr) return null;
  const clean = icsDateStr.trim();

  const fullMatch = clean.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i
  );
  if (fullMatch) {
    const [, y, m, d, hh, mm, ss, isUtc] = fullMatch;
    if (isUtc) {
      return new Date(
        Date.UTC(
          parseInt(y, 10),
          parseInt(m, 10) - 1,
          parseInt(d, 10),
          parseInt(hh, 10),
          parseInt(mm, 10),
          parseInt(ss, 10)
        )
      );
    }
    return new Date(
      parseInt(y, 10),
      parseInt(m, 10) - 1,
      parseInt(d, 10),
      parseInt(hh, 10),
      parseInt(mm, 10),
      parseInt(ss, 10)
    );
  }

  const dateOnlyMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return new Date(
      parseInt(y, 10),
      parseInt(m, 10) - 1,
      parseInt(d, 10),
      23,
      59,
      0
    );
  }

  return null;
}

/**
 * Matches a Moodle event's course hint (CATEGORIES / course fullname / summary)
 * against the user's active schedule courses and Cheesefork catalog.
 */
export function matchCourseForMoodleTask(
  courseHint: string,
  events: ScheduleEvent[],
  catalog: CourseCatalogItem[],
  fallbackLabel = 'Moodle Assignments (מטלות מודל)',
  fallbackKey = 'custom:moodle-synced'
): {
  relationKey: string;
  courseId?: string;
  courseTitle: string;
} {
  const hint = (courseHint || '').trim();

  // 1. Try matching by 6-to-8 digit Technion course number in hint
  const numberMatches = hint.match(/\b\d{6,8}\b/g) || [];
  for (const rawNum of numberMatches) {
    // Technion 6-digit FFFNNN maps to 8-digit Cheesefork ID 0FFF0NNN (e.g. 104018 -> 01040018)
    const technion8 =
      rawNum.length === 6
        ? `0${rawNum.slice(0, 3)}0${rawNum.slice(3)}`
        : rawNum.padStart(8, '0');
    const legacyPad8 = rawNum.length === 6 ? `0${rawNum}0` : technion8;

    const matchesCourseId = (cid: string) =>
      cid === rawNum ||
      cid === technion8 ||
      cid === legacyPad8 ||
      cid.includes(rawNum) ||
      rawNum.includes(cid);

    // Check active schedule events first
    const matchedScheduleEv = events.find(
      (e) => e.courseId && matchesCourseId(e.courseId)
    );
    if (matchedScheduleEv && matchedScheduleEv.courseId) {
      return {
        relationKey: `course:${matchedScheduleEv.courseId}`,
        courseId: matchedScheduleEv.courseId,
        courseTitle: matchedScheduleEv.title,
      };
    }

    // Check full Cheesefork catalog
    const matchedCatalog = catalog.find((c) => matchesCourseId(c.courseId));
    if (matchedCatalog) {
      return {
        relationKey: `course:${matchedCatalog.courseId}`,
        courseId: matchedCatalog.courseId,
        courseTitle: matchedCatalog.name,
      };
    }
  }

  // 2. Try matching by active course title substring
  const uniqueScheduleCourses = new Map<string, string>();
  for (const ev of events) {
    if (ev.courseId && ev.title) {
      uniqueScheduleCourses.set(ev.courseId, ev.title);
    }
  }
  for (const [cid, cTitle] of uniqueScheduleCourses.entries()) {
    if (cTitle.length >= 3 && hint.toLowerCase().includes(cTitle.toLowerCase())) {
      return {
        relationKey: `course:${cid}`,
        courseId: cid,
        courseTitle: cTitle,
      };
    }
  }

  // 3. If a 6-8 digit course number was present in hint, use its canonical ID before generic fallback
  if (numberMatches.length > 0) {
    const rawNum = numberMatches[0];
    return {
      relationKey: `course:${rawNum}`,
      courseId: rawNum,
      courseTitle: `Course ${rawNum}`,
    };
  }

  // 3. Fallback: assign to first active course if present, or a dedicated "Moodle Tasks" group
  const firstCourseEv = events.find((e) => Boolean(e.courseId));
  if (firstCourseEv && firstCourseEv.courseId) {
    return {
      relationKey: `course:${firstCourseEv.courseId}`,
      courseId: firstCourseEv.courseId,
      courseTitle: firstCourseEv.title,
    };
  }

  return {
    relationKey: fallbackKey,
    courseTitle: fallbackLabel,
  };
}

/**
 * Deduplicates incoming synced tasks against existing local tasks by title & deadline minute,
 * returning the sorted merged task array and the number of newly added tasks.
 */
export function mergeSyncedTasks(
  existing: CourseTask[],
  incoming: CourseTask[]
): { merged: CourseTask[]; newlyAddedCount: number } {
  const signatureFor = (task: CourseTask) =>
    `${task.title.trim().toLowerCase()}__${Math.floor(
      new Date(task.deadlineISO).getTime() / 60000
    )}`;

  const existingSignatures = new Set(existing.map(signatureFor));
  const merged = [...existing];
  let newlyAddedCount = 0;

  for (const item of incoming) {
    const sig = signatureFor(item);
    if (!existingSignatures.has(sig)) {
      existingSignatures.add(sig);
      merged.push(item);
      newlyAddedCount += 1;
    }
  }

  merged.sort((a, b) => a.deadlineISO.localeCompare(b.deadlineISO));
  return { merged, newlyAddedCount };
}
