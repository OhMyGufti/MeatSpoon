// App.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  PanResponder,
  GestureResponderEvent,
  Animated,
  Linking,
  Platform,
  ToastAndroid,
  Switch,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { WebView, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import {
  ScheduleEvent,
  CourseCatalogItem,
  CourseExam,
  CourseTask,
  DayOfWeek,
} from './src/types/schedule';
import { layoutDayEvents } from './src/utils/overlapLayout';
import {
  generateAutoSchedules,
  GeneratedScheduleOption,
} from './src/utils/autoScheduleBuilder';
import {
  fetchCheeseforkCatalog,
  mergeIdenticalCourseGroups,
  CHEESEFORK_JS_URL,
} from './src/services/cheesefork';
import {
  MOODLE_LOGIN_URL,
  MOODLE_CALENDAR_EXPORT_PAGE_URL,
  MOODLE_CALENDAR_EXPORT_URL,
  MOODLE_UPCOMING_EVENTS_URL,
  MOODLE_INJECTED_SYNC_SCRIPT,
  MOODLE_BG_INJECTED_SYNC_SCRIPT,
  isMoodleAuthenticatedUrl,
  isMoodleLoginRedirectUrl,
  parseMoodleSyncPayload,
  parseMoodleWebImportText,
  mergeSyncedTasks,
} from './src/services/moodleSync';
import {
  WEBWORK_LOGIN_URL,
  WEBWORK_INJECTED_SYNC_SCRIPT,
  WEBWORK_MOODLE_NAVIGATION_HELPER_SCRIPT,
  isWebworkAuthenticatedUrl,
  parseWebworkSyncPayload,
  parseWebworkTextInput,
  WebworkCourseOverride,
} from './src/services/webworkSync';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
// Feature 1: RTL Schedule Layout (Sunday = 0 on the far right, Thursday = 4 on the far left)
const RTL_DAY_INDICES: DayOfWeek[] = [4, 3, 2, 1, 0];
const ASYNC_STORAGE_KEY = '@meatspoon_persisted_state_v1';

const START_HOUR = 8;
const END_HOUR = 20;
const DEFAULT_PIXELS_PER_HOUR = 60;
const MIN_PIXELS_PER_HOUR = 36;
const MAX_PIXELS_PER_HOUR = 140;

const COLOR_PALETTE = [
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#8B5CF6', // Violet
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#EF4444', // Red
  '#14B8A6', // Teal
  '#6366F1', // Indigo
];

const GROUP_SECTIONS: {
  type: 'Lecture' | 'Tutorial' | 'Lab';
  label: string;
  accentColor: string;
  bgColor: string;
}[] = [
  {
    type: 'Lecture',
    label: 'Lectures (הרצאה)',
    accentColor: '#1D4ED8',
    bgColor: '#EFF6FF',
  },
  {
    type: 'Tutorial',
    label: 'Tutorials (תרגול)',
    accentColor: '#047857',
    bgColor: '#ECFDF5',
  },
  {
    type: 'Lab',
    label: 'Labs & Projects (מעבדה)',
    accentColor: '#6D28D9',
    bgColor: '#F5F3FF',
  },
];

// Technion Special Group Numbering Filter Definitions
interface SpecialGroupFilter {
  id: string;
  label: string;
  matches: (groupNum: number, rawGroupId: string) => boolean;
}

const SPECIAL_GROUP_FILTERS: SpecialGroupFilter[] = [
  {
    id: '70-79',
    label: '70-79 (GTIIT/China)',
    matches: (n) => n >= 70 && n <= 79,
  },
  {
    id: '80-89',
    label: '80-89 (English)',
    matches: (n) => n >= 80 && n <= 89,
  },
  {
    id: '90-99',
    label: '90-99 (Intl/Prep)',
    matches: (n) => n >= 90 && n <= 99,
  },
  {
    id: '50-69',
    label: '50-69 (Faculty/Med)',
    matches: (n) => n >= 50 && n <= 69,
  },
  {
    id: '40-49',
    label: '40-49 (Online/Hybrid)',
    matches: (n) => n >= 40 && n <= 49,
  },
  {
    id: '00-01',
    label: '00-01 (Admin/Virtual)',
    matches: (n, raw) =>
      n === 0 || n === 1 || raw === '00' || raw === '01' || raw === '0' || raw === '1',
  },
];

interface SpontaneousEventItem {
  key: string;
  courseId: string;
  courseName: string;
  type: string;
  groupId: string;
  lecturer: string;
  location: string;
  startHour: number;
  endHour: number;
  minutesUntilStart: number;
  color: string;
}

interface LocalBackupPayload {
  version: number;
  exportedAt: string;
  events: ScheduleEvent[];
  tasks: CourseTask[];
  desiredCourseIds: string[];
  lockedEvents: ScheduleEvent[];
  hiddenKeys: Record<string, boolean>;
  includedSpecialGroups: Record<string, boolean>;
  autoOpenMoodleLogin?: boolean;
}

/**
 * Returns a canonical relation key used to link related events:
 * - Course events (and custom/exam events assigned to a course) share `course:${courseId}`
 * - Custom event groups share `custom:${groupId}`
 */
function getEventRelationKey(ev: ScheduleEvent): string {
  if (ev.courseId) {
    return `course:${ev.courseId}`;
  }
  if (ev.groupId) {
    return `custom:${ev.groupId}`;
  }
  return `custom:${ev.title}`;
}

/**
 * Checks whether a group ID should be shown given the current enabled special group filters.
 */
function isGroupAllowedByFilters(
  rawGroupId: string,
  includedFilterIds: Record<string, boolean>
): boolean {
  const trimmed = rawGroupId.replace(/[\[\]]/g, '').trim();
  const parsedNum = parseInt(trimmed, 10);
  if (isNaN(parsedNum)) return true;

  for (const rule of SPECIAL_GROUP_FILTERS) {
    if (rule.matches(parsedNum, trimmed)) {
      return Boolean(includedFilterIds[rule.id]);
    }
  }
  return true;
}

/**
 * Returns the Sunday (00:00:00 local time) of the week containing `refDate`.
 */
function getStartOfWeekSunday(refDate: Date): Date {
  const d = new Date(refDate);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Formats a Date object as local "YYYY-MM-DD".
 */
function toLocalDateISO(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formats a Date object as "DD/MM".
 */
function toShortDayMonth(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * Formats a Date object as "DD/MM/YYYY".
 */
function toFullDayMonthYear(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Parses a "YYYY-MM-DD" string into a local Date object.
 */
function parseISODateLocal(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

/**
 * Formats remaining milliseconds until a task deadline into a dynamic countdown string.
 */
function formatTaskCountdown(deadlineISO: string, nowMs: number): {
  text: string;
  isOverdue: boolean;
  isUrgent: boolean;
} {
  const targetMs = new Date(deadlineISO).getTime();
  if (isNaN(targetMs)) {
    return { text: 'Invalid date', isOverdue: false, isUrgent: false };
  }

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    const overdueMins = Math.floor(Math.abs(diffMs) / 60000);
    const overdueDays = Math.floor(overdueMins / (60 * 24));
    const overdueHours = Math.floor((overdueMins % (60 * 24)) / 60);
    return {
      text:
        overdueDays > 0
          ? `Overdue by ${overdueDays}d ${overdueHours}h`
          : `Overdue by ${overdueHours}h ${overdueMins % 60}m`,
      isOverdue: true,
      isUrgent: true,
    };
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const isUrgent = days < 2;
  if (days > 0) {
    return {
      text: `${days}d ${hours}h ${minutes}m left`,
      isOverdue: false,
      isUrgent,
    };
  }
  return {
    text: `${hours}h ${minutes}m left`,
    isOverdue: false,
    isUrgent: true,
  };
}

export default function App() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [catalog, setCatalog] = useState<CourseCatalogItem[]>([]);
  const [loadingLiveCatalog, setLoadingLiveCatalog] = useState(false);
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);

  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [tasks, setTasks] = useState<CourseTask[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [selectedTask, setSelectedTask] = useState<CourseTask | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Record<string, boolean>>({});
  const [isHydratingStorage, setIsHydratingStorage] = useState<boolean>(true);

  // Live Real-World Clock for Current Time Indicator & Task Countdowns
  const [nowDate, setNowDate] = useState<Date>(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setNowDate(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Date-Aware Calendar State: Sunday of the currently viewed real-world week
  const [currentWeekSunday, setCurrentWeekSunday] = useState<Date>(() =>
    getStartOfWeekSunday(new Date())
  );

  // Vertical Pinch-to-Zoom State (`pixelsPerHour`)
  const [pixelsPerHour, setPixelsPerHour] = useState<number>(DEFAULT_PIXELS_PER_HOUR);
  const [isPinching, setIsPinching] = useState<boolean>(false);
  const pixelsPerHourRef = useRef<number>(DEFAULT_PIXELS_PER_HOUR);
  pixelsPerHourRef.current = pixelsPerHour;

  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartHeightRef = useRef<number>(DEFAULT_PIXELS_PER_HOUR);

  // Smooth horizontal slide animation state for Week Navigation (Swipe & Buttons)
  const weekSlideAnim = useRef(new Animated.Value(0)).current;
  const weekOpacityAnim = useRef(new Animated.Value(1)).current;
  const shiftWeekRef = useRef<(deltaWeeks: number) => void>(() => {});

  // PanResponder for Vertical Pinch-to-Zoom (2 fingers) AND Horizontal Week Swipe (1 finger)
  const pinchPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) =>
        evt.nativeEvent.touches.length >= 2,
      onStartShouldSetPanResponderCapture: (evt) =>
        evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (evt.nativeEvent.touches.length >= 2) return true;
        return (
          Math.abs(gestureState.dx) > 28 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.6
        );
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        if (evt.nativeEvent.touches.length >= 2) return true;
        return (
          Math.abs(gestureState.dx) > 36 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.8
        );
      },
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          setIsPinching(true);
          const dy = Math.abs(touches[0].pageY - touches[1].pageY);
          pinchStartDistanceRef.current = Math.max(dy, 20);
          pinchStartHeightRef.current = pixelsPerHourRef.current;
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const currentDy = Math.abs(touches[0].pageY - touches[1].pageY);
          if (pinchStartDistanceRef.current === null) {
            setIsPinching(true);
            pinchStartDistanceRef.current = Math.max(currentDy, 20);
            pinchStartHeightRef.current = pixelsPerHourRef.current;
            return;
          }

          const scaleMultiplier =
            Math.max(currentDy, 10) / pinchStartDistanceRef.current;
          const nextPixelsPerHour = Math.round(
            Math.min(
              MAX_PIXELS_PER_HOUR,
              Math.max(
                MIN_PIXELS_PER_HOUR,
                pinchStartHeightRef.current * scaleMultiplier
              )
            )
          );
          setPixelsPerHour(nextPixelsPerHour);
        } else if (
          touches.length === 1 &&
          pinchStartDistanceRef.current === null &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4
        ) {
          // Live drag feedback during horizontal swipe
          weekSlideAnim.setValue(gestureState.dx * 0.35);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const wasPinching = pinchStartDistanceRef.current !== null;
        pinchStartDistanceRef.current = null;
        setIsPinching(false);

        if (
          !wasPinching &&
          Math.abs(gestureState.dx) > 50 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4
        ) {
          // Swipe left (dx < 0) -> next week (+1); Swipe right (dx > 0) -> prev week (-1)
          shiftWeekRef.current(gestureState.dx < 0 ? 1 : -1);
        } else {
          Animated.spring(weekSlideAnim, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 6,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        pinchStartDistanceRef.current = null;
        setIsPinching(false);
        Animated.spring(weekSlideAnim, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
      onShouldBlockNativeResponder: () => true,
    })
  ).current;

  // Double-tap tracking ref for "My Courses" items
  const lastTapRef = useRef<{ key: string; time: number }>({ key: '', time: 0 });
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Special Group Filters State (false = excluded, true = included)
  const [includedSpecialGroups, setIncludedSpecialGroups] = useState<
    Record<string, boolean>
  >({
    '70-79': false,
    '80-89': true,
    '90-99': false,
    '50-69': true,
    '40-49': true,
    '00-01': false,
  });

  // Live refs for async WebView / Web import callbacks
  const catalogRef = useRef<CourseCatalogItem[]>(catalog);
  catalogRef.current = catalog;
  const eventsRef = useRef<ScheduleEvent[]>(events);
  eventsRef.current = events;
  const tasksRef = useRef<CourseTask[]>(tasks);
  tasksRef.current = tasks;

  // Modals
  const [spoonMenuVisible, setSpoonMenuVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [moodleModalVisible, setMoodleModalVisible] = useState(false);
  const [moodleCurrentUrl, setMoodleCurrentUrl] = useState(MOODLE_LOGIN_URL);
  const [moodleSyncing, setMoodleSyncing] = useState(false);
  const [moodleWebPasteText, setMoodleWebPasteText] = useState('');
  const moodleWebViewRef = useRef<WebView<{}> | null>(null);

  // Silent Background Moodle Sync on Mount & Auto-Login Prompt Setting (Native WebView only)
  const [autoOpenMoodleLogin, setAutoOpenMoodleLogin] = useState<boolean>(true);
  const autoOpenMoodleLoginRef = useRef<boolean>(true);
  autoOpenMoodleLoginRef.current = autoOpenMoodleLogin;
  const [bgMoodleSyncActive, setBgMoodleSyncActive] = useState<boolean>(
    () => Platform.OS !== 'web'
  );
  const bgMoodleWebViewRef = useRef<WebView<{}> | null>(null);
  const bgMoodleHandledRef = useRef(false);
  const [toastBanner, setToastBanner] = useState<{
    message: string;
    variant: 'success' | 'warning';
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [webworkModalVisible, setWebworkModalVisible] = useState(false);
  const [webworkCurrentUrl, setWebworkCurrentUrl] = useState(WEBWORK_LOGIN_URL);
  const [webworkSyncing, setWebworkSyncing] = useState(false);
  const [webworkWebPasteText, setWebworkWebPasteText] = useState('');
  const [webworkWebCourseKey, setWebworkWebCourseKey] = useState<string | null>(null);
  const [webworkWebDropdownOpen, setWebworkWebDropdownOpen] = useState(false);
  const [webSyncFeedback, setWebSyncFeedback] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const webworkWebViewRef = useRef<WebView<{}> | null>(null);
  const [aboutModalVisible, setAboutModalVisible] = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [autoBuilderModalVisible, setAutoBuilderModalVisible] = useState(false);
  const [freeTimeModalVisible, setFreeTimeModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // "Free Time" Spontaneous Finder State
  const [spontaneousEvents, setSpontaneousEvents] = useState<SpontaneousEventItem[]>([]);
  const [freeTimeCheckedAt, setFreeTimeCheckedAt] = useState<Date | null>(null);

  // Auto-Builder State
  const [autoSearchQuery, setAutoSearchQuery] = useState('');
  const [desiredCourseIds, setDesiredCourseIds] = useState<string[]>([]);
  const [lockedEvents, setLockedEvents] = useState<ScheduleEvent[]>([]);
  const [lockTitle, setLockTitle] = useState('');
  const [lockDay, setLockDay] = useState<DayOfWeek>(0);
  const [lockStart, setLockStart] = useState('14');
  const [lockEnd, setLockEnd] = useState('17');
  const [generatedOptions, setGeneratedOptions] = useState<
    GeneratedScheduleOption[]
  >([]);
  const [hasRunAutoBuilder, setHasRunAutoBuilder] = useState(false);

  // Custom Event Form State
  const [customTitle, setCustomTitle] = useState('');
  const [customDay, setCustomDay] = useState<DayOfWeek>(0);
  const [customStart, setCustomStart] = useState('14');
  const [customEnd, setCustomEnd] = useState('17');
  const [customColor, setCustomColor] = useState(COLOR_PALETTE[3]);
  // null = "Create New Group"
  const [customAssignedRelationKey, setCustomAssignedRelationKey] = useState<
    string | null
  >(null);
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);

  // Feature 4: Tasks/Assignments Tracker ("מטלות") Form State
  const [taskTitle, setTaskTitle] = useState('');
  const [taskRelationKey, setTaskRelationKey] = useState<string | null>(null);
  const [taskDropdownOpen, setTaskDropdownOpen] = useState(false);
  const [taskDateStr, setTaskDateStr] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return toFullDayMonthYear(d);
  });
  const [taskTimeStr, setTaskTimeStr] = useState('23:59');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskUrl, setTaskUrl] = useState('');

  // Feature 6: Clipboard & Text-Input Schedule Export/Import State
  const [backupBusy, setBackupBusy] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');

  // Load saved schedule data (courses, custom events, tasks, filters) from AsyncStorage on mount
  useEffect(() => {
    let isMounted = true;
    const loadPersistedSchedule = async () => {
      try {
        const savedJson = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
        if (savedJson && isMounted) {
          const parsed = JSON.parse(savedJson) as Partial<LocalBackupPayload>;
          if (Array.isArray(parsed.events)) {
            setEvents(parsed.events);
          }
          if (Array.isArray(parsed.tasks)) {
            setTasks(parsed.tasks);
          }
          if (Array.isArray(parsed.desiredCourseIds)) {
            setDesiredCourseIds(parsed.desiredCourseIds);
          }
          if (Array.isArray(parsed.lockedEvents)) {
            setLockedEvents(parsed.lockedEvents);
          }
          if (parsed.hiddenKeys && typeof parsed.hiddenKeys === 'object') {
            setHiddenKeys(parsed.hiddenKeys);
          }
          if (
            parsed.includedSpecialGroups &&
            typeof parsed.includedSpecialGroups === 'object'
          ) {
            setIncludedSpecialGroups((prev) => ({
              ...prev,
              ...parsed.includedSpecialGroups,
            }));
          }
          if (typeof parsed.autoOpenMoodleLogin === 'boolean') {
            setAutoOpenMoodleLogin(parsed.autoOpenMoodleLogin);
            autoOpenMoodleLoginRef.current = parsed.autoOpenMoodleLogin;
          }
        }
      } catch (err) {
        console.warn('Failed to load schedule state from AsyncStorage:', err);
      } finally {
        if (isMounted) {
          setIsHydratingStorage(false);
        }
      }
    };

    loadPersistedSchedule();
    return () => {
      isMounted = false;
    };
  }, []);

  // Save schedule data back to AsyncStorage whenever courses, custom events, tasks, or settings change
  useEffect(() => {
    if (isHydratingStorage) return;

    const persistSchedule = async () => {
      try {
        const payload: LocalBackupPayload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          events,
          tasks,
          desiredCourseIds,
          lockedEvents,
          hiddenKeys,
          includedSpecialGroups,
          autoOpenMoodleLogin,
        };
        await AsyncStorage.setItem(ASYNC_STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.warn('Failed to save schedule state to AsyncStorage:', err);
      }
    };

    persistSchedule();
  }, [
    isHydratingStorage,
    events,
    tasks,
    desiredCourseIds,
    lockedEvents,
    hiddenKeys,
    includedSpecialGroups,
    autoOpenMoodleLogin,
  ]);

  // Automatically sync Cheesefork JS data when opening the Courses or Auto-Builder modal
  useEffect(() => {
    if (
      (searchModalVisible || autoBuilderModalVisible) &&
      catalog.length === 0 &&
      !loadingLiveCatalog
    ) {
      handleSyncCheesefork();
    }
  }, [searchModalVisible, autoBuilderModalVisible]);

  // Clear highlight if all events for the highlighted course are removed
  useEffect(() => {
    if (
      highlightedKey &&
      !events.some((ev) => getEventRelationKey(ev) === highlightedKey)
    ) {
      setHighlightedKey(null);
    }
  }, [events, highlightedKey]);

  // Compute the 5 real-world dates (Sun - Thu) for the currently viewed week
  const currentWeekDates = useMemo(() => {
    return DAYS.map((_, dayIdx) => {
      const d = new Date(currentWeekSunday);
      d.setDate(currentWeekSunday.getDate() + dayIdx);
      return {
        date: d,
        dateISO: toLocalDateISO(d),
        shortLabel: toShortDayMonth(d),
      };
    });
  }, [currentWeekSunday]);

  const todayISO = toLocalDateISO(nowDate);
  const currentDecimalHour =
    nowDate.getHours() + nowDate.getMinutes() / 60 + nowDate.getSeconds() / 3600;
  const showCurrentTimeIndicator =
    currentDecimalHour >= START_HOUR && currentDecimalHour <= END_HOUR;
  const currentTimeTopPx = (currentDecimalHour - START_HOUR) * pixelsPerHour;
  const currentTimeFormatted = `${String(nowDate.getHours()).padStart(
    2,
    '0'
  )}:${String(nowDate.getMinutes()).padStart(2, '0')}`;

  // Shift current week forward or backward with smooth horizontal slide animation
  const shiftWeek = (deltaWeeks: number) => {
    const slideOutX = deltaWeeks > 0 ? -width * 0.45 : width * 0.45;
    const slideInStartX = deltaWeeks > 0 ? width * 0.45 : -width * 0.45;

    Animated.parallel([
      Animated.timing(weekSlideAnim, {
        toValue: slideOutX,
        duration: 130,
        useNativeDriver: true,
      }),
      Animated.timing(weekOpacityAnim, {
        toValue: 0.25,
        duration: 130,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentWeekSunday((prev) => {
        const next = new Date(prev);
        next.setDate(prev.getDate() + deltaWeeks * 7);
        return next;
      });

      weekSlideAnim.setValue(slideInStartX);
      Animated.parallel([
        Animated.spring(weekSlideAnim, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 5,
          speed: 18,
        }),
        Animated.timing(weekOpacityAnim, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };
  shiftWeekRef.current = shiftWeek;

  // Jump calendar to the week containing a specific "YYYY-MM-DD" date
  const jumpToDateISO = (dateISO: string) => {
    const targetDate = parseISODateLocal(dateISO);
    setCurrentWeekSunday(getStartOfWeekSunday(targetDate));
  };

  // Collect all tracked course IDs from user's schedule state (`events` + `desiredCourseIds`)
  const trackedCourseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ev of events) {
      if (ev.courseId) ids.add(ev.courseId);
    }
    for (const cid of desiredCourseIds) {
      ids.add(cid);
    }
    return Array.from(ids);
  }, [events, desiredCourseIds]);

  // Extract all exams (Moed A, Moed B, etc.) for tracked courses from the Cheesefork catalog
  const trackedExams = useMemo(() => {
    const examList: (CourseExam & { color: string })[] = [];
    for (const cid of trackedCourseIds) {
      const catalogCourse = catalog.find((c) => c.courseId === cid);
      if (!catalogCourse || !catalogCourse.exams) continue;

      const courseEvent = events.find((e) => e.courseId === cid);
      const color = courseEvent ? courseEvent.color : '#DC2626';

      for (const ex of catalogCourse.exams) {
        examList.push({
          ...ex,
          color,
        });
      }
    }
    return examList.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  }, [trackedCourseIds, catalog, events]);

  // Convert tracked exams that fall within the currently viewed week into ScheduleEvent blocks
  const currentWeekExamEvents = useMemo(() => {
    const examEvents: ScheduleEvent[] = [];
    const fridayDate = new Date(currentWeekSunday);
    fridayDate.setDate(currentWeekSunday.getDate() + 5);
    const fridayISO = toLocalDateISO(fridayDate);

    for (const ex of trackedExams) {
      // Match Sun - Thu columns directly
      const matchedDayIdx = currentWeekDates.findIndex(
        (wd) => wd.dateISO === ex.dateISO
      );

      if (matchedDayIdx !== -1) {
        examEvents.push({
          id: ex.id,
          courseId: ex.courseId,
          title: `📝 EXAM: ${ex.courseName}`,
          type: 'Exam',
          lecturer: ex.moedLabel,
          location: `${ex.displayDate}`,
          day: matchedDayIdx as DayOfWeek,
          startHour: ex.startHour,
          endHour: ex.endHour,
          color: '#B91C1C',
          examDateISO: ex.dateISO,
        });
      } else if (ex.dateISO === fridayISO) {
        // If an exam falls on Friday of the viewed week, display it in Thursday's column (leftmost in RTL) with a Friday tag
        examEvents.push({
          id: ex.id,
          courseId: ex.courseId,
          title: `📝 EXAM (Fri): ${ex.courseName}`,
          type: 'Exam',
          lecturer: ex.moedLabel,
          location: `Fri ${ex.displayDate}`,
          day: 4,
          startHour: ex.startHour,
          endHour: ex.endHour,
          color: '#B91C1C',
          examDateISO: ex.dateISO,
        });
      }
    }
    return examEvents;
  }, [trackedExams, currentWeekDates, currentWeekSunday]);

  // Build unique active groups for the "My Courses" section, Custom Event group picker, and Task group picker
  const activeCourseItems = useMemo(() => {
    const map = new Map<
      string,
      {
        relationKey: string;
        courseId?: string;
        groupId?: string;
        title: string;
        color: string;
        typesSummary: string[];
        sessionCount: number;
        isHidden: boolean;
      }
    >();

    for (const ev of events) {
      const key = getEventRelationKey(ev);
      const badgeLabel =
        ev.type === 'Custom'
          ? ev.title
          : ev.groupId
          ? `${ev.type} ${ev.groupId}`
          : ev.type;

      if (!map.has(key)) {
        map.set(key, {
          relationKey: key,
          courseId: ev.courseId,
          groupId: ev.groupId,
          title: ev.courseId ? ev.title : ev.lecturer || ev.title,
          color: ev.color,
          typesSummary: [badgeLabel],
          sessionCount: 1,
          isHidden: Boolean(hiddenKeys[key]),
        });
      } else {
        const entry = map.get(key)!;
        entry.sessionCount += 1;
        if (!entry.typesSummary.includes(badgeLabel)) {
          entry.typesSummary.push(badgeLabel);
        }
      }
    }

    // Ensure courses/groups that only have synced Moodle/Webwork tasks also appear in "My Courses"
    let fallbackColorIdx = 0;
    for (const tsk of tasks) {
      if (!map.has(tsk.relationKey)) {
        const matchedEv = tsk.courseId
          ? events.find((e) => e.courseId === tsk.courseId)
          : undefined;
        const assignedColor = matchedEv
          ? matchedEv.color
          : COLOR_PALETTE[fallbackColorIdx++ % COLOR_PALETTE.length];
        map.set(tsk.relationKey, {
          relationKey: tsk.relationKey,
          courseId: tsk.courseId,
          title: tsk.courseTitle || tsk.groupTitle || 'Course Tasks',
          color: assignedColor,
          typesSummary: [tsk.source ? `${tsk.source} Tasks` : 'Tasks'],
          sessionCount: 0,
          isHidden: Boolean(hiddenKeys[tsk.relationKey]),
        });
      }
    }

    return Array.from(map.values());
  }, [events, tasks, hiddenKeys]);

  // Helper to resolve the exact Course color for any task (matching its associated Course)
  const getTaskCourseColor = (tsk: CourseTask): string => {
    const byRelation = activeCourseItems.find(
      (item) => item.relationKey === tsk.relationKey
    );
    if (byRelation) return byRelation.color;

    if (tsk.courseId) {
      const byCourseId = activeCourseItems.find(
        (item) => item.courseId === tsk.courseId
      );
      if (byCourseId) return byCourseId.color;

      const evByCourse = events.find((e) => e.courseId === tsk.courseId);
      if (evByCourse) return evByCourse.color;
    }

    return COLOR_PALETTE[0];
  };

  // Compute active tasks falling within the currently viewed week (pinned at top of day column & on grid)
  const { currentWeekTasksByDay, currentWeekTaskEvents } = useMemo(() => {
    const byDay: Record<
      number,
      (CourseTask & { color: string; dayTag?: string })[]
    > = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
    };
    const taskGridEvents: ScheduleEvent[] = [];

    const fridayDate = new Date(currentWeekSunday);
    fridayDate.setDate(currentWeekSunday.getDate() + 5);
    const fridayISO = toLocalDateISO(fridayDate);

    const saturdayDate = new Date(currentWeekSunday);
    saturdayDate.setDate(currentWeekSunday.getDate() + 6);
    const saturdayISO = toLocalDateISO(saturdayDate);

    for (const tsk of tasks) {
      if (hiddenKeys[tsk.relationKey]) continue;

      const d = new Date(tsk.deadlineISO);
      if (isNaN(d.getTime())) continue;
      const taskDateISO = toLocalDateISO(d);
      const courseColor = getTaskCourseColor(tsk);

      let targetDayIdx = currentWeekDates.findIndex(
        (wd) => wd.dateISO === taskDateISO
      );
      let dayTag: string | undefined = undefined;

      if (targetDayIdx === -1) {
        if (taskDateISO === fridayISO) {
          targetDayIdx = 4;
          dayTag = 'Fri';
        } else if (taskDateISO === saturdayISO) {
          targetDayIdx = 4;
          dayTag = 'Sat';
        }
      }

      if (targetDayIdx !== -1) {
        byDay[targetDayIdx].push({
          ...tsk,
          color: courseColor,
          dayTag,
        });

        const dueDecHour = d.getHours() + d.getMinutes() / 60;
        // Render on time grid at due hour (clamped into visible 8:00-20:00 range if due during the day)
        if (dueDecHour >= START_HOUR && dueDecHour < END_HOUR) {
          const startH = Math.max(START_HOUR, Math.min(END_HOUR - 1, dueDecHour - 0.5));
          const endH = Math.min(END_HOUR, startH + 1);
          taskGridEvents.push({
            id: `cal-task-${tsk.id}`,
            taskId: tsk.id,
            courseId: tsk.courseId,
            groupId: tsk.relationKey.replace(/^custom:/, ''),
            title: `📌 ${tsk.title}`,
            type: 'Task',
            lecturer: tsk.courseTitle || tsk.groupTitle || 'Task Due',
            location: `${dayTag ? `${dayTag} ` : ''}Due ${formatHour(dueDecHour)}`,
            day: targetDayIdx as DayOfWeek,
            startHour: startH,
            endHour: endH,
            color: courseColor,
          });
        }
      }
    }

    return {
      currentWeekTasksByDay: byDay,
      currentWeekTaskEvents: taskGridEvents,
    };
  }, [tasks, hiddenKeys, currentWeekDates, currentWeekSunday, activeCourseItems, events]);

  // Feature 3: Tap-to-Create Custom Event on empty calendar slot
  const handleEmptySlotTap = (
    dayIndex: DayOfWeek,
    hourSlot: number,
    evt: GestureResponderEvent
  ) => {
    const locationY = evt.nativeEvent.locationY ?? 0;
    const isBottomHalf = locationY >= pixelsPerHour / 2;
    const startHour = isBottomHalf ? hourSlot + 0.5 : hourSlot;
    const endHour = Math.min(END_HOUR, startHour + 1);

    setCustomDay(dayIndex);
    setCustomStart(String(startHour));
    setCustomEnd(String(endHour));
    setGroupDropdownOpen(false);
    setCustomModalVisible(true);
  };

  // Feature 4: Tasks/Assignments Tracker ("מטלות") Creation & Removal
  const applyTaskPresetDays = (daysFromNow: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    setTaskDateStr(toFullDayMonthYear(d));
  };

  const handleOpenTaskModal = (defaultRelationKey?: string) => {
    if (activeCourseItems.length === 0) {
      Alert.alert(
        'No Active Course Groups',
        'Add a course or custom group to your schedule first so you can link a task (מטלה) to it.'
      );
      return;
    }
    const chosenKey =
      defaultRelationKey ||
      (taskRelationKey &&
      activeCourseItems.some((i) => i.relationKey === taskRelationKey)
        ? taskRelationKey
        : activeCourseItems[0].relationKey);
    setTaskRelationKey(chosenKey);
    setTaskDropdownOpen(false);
    setTaskModalVisible(true);
  };

  const handleAddTask = () => {
    const trimmedTitle = taskTitle.trim();
    if (!trimmedTitle) {
      Alert.alert('Missing Title', 'Please enter a task/assignment title (שם מטלה).');
      return;
    }
    const targetGroup =
      activeCourseItems.find((i) => i.relationKey === taskRelationKey) ||
      activeCourseItems[0];
    if (!targetGroup) {
      Alert.alert('Missing Course Group', 'Please select a course group for this task.');
      return;
    }

    // Parse DD/MM/YYYY or YYYY-MM-DD
    const dmyMatch = taskDateStr
      .trim()
      .match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    const ymdMatch = taskDateStr
      .trim()
      .match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);

    let year = 0;
    let month = 0;
    let day = 0;

    if (dmyMatch) {
      day = parseInt(dmyMatch[1], 10);
      month = parseInt(dmyMatch[2], 10);
      year = parseInt(dmyMatch[3], 10);
      if (year < 100) year += 2000;
    } else if (ymdMatch) {
      year = parseInt(ymdMatch[1], 10);
      month = parseInt(ymdMatch[2], 10);
      day = parseInt(ymdMatch[3], 10);
    } else {
      Alert.alert(
        'Invalid Date Format',
        'Please enter the deadline date as DD/MM/YYYY (e.g. 25/12/2026).'
      );
      return;
    }

    const timeMatch = taskTimeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
    const hours = timeMatch ? parseInt(timeMatch[1], 10) : 23;
    const minutes = timeMatch ? parseInt(timeMatch[2], 10) : 59;

    const deadlineDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (isNaN(deadlineDate.getTime())) {
      Alert.alert('Invalid Date', 'Could not parse deadline date/time.');
      return;
    }

    const newTask: CourseTask = {
      id: `task-${Date.now()}`,
      relationKey: targetGroup.relationKey,
      courseId: targetGroup.courseId,
      courseTitle: targetGroup.title,
      groupTitle: targetGroup.title,
      title: trimmedTitle,
      deadlineISO: deadlineDate.toISOString(),
      description: taskDescription.trim() || undefined,
      url: taskUrl.trim() || undefined,
      source: 'Manual',
      createdAtISO: new Date().toISOString(),
    };

    setTasks((prev) =>
      [...prev, newTask].sort((a, b) =>
        a.deadlineISO.localeCompare(b.deadlineISO)
      )
    );
    setTaskTitle('');
    setTaskDescription('');
    setTaskUrl('');
    setTaskModalVisible(false);
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask((prev) => (prev && prev.id === taskId ? null : prev));
  };

  // Shared persistence & merge helper for Moodle / WebWork synced tasks
  const persistTasksSnapshot = async (nextTasks: CourseTask[]) => {
    try {
      const payload: LocalBackupPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        events: eventsRef.current,
        tasks: nextTasks,
        desiredCourseIds,
        lockedEvents,
        hiddenKeys,
        includedSpecialGroups,
        autoOpenMoodleLogin: autoOpenMoodleLoginRef.current,
      };
      await AsyncStorage.setItem(ASYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('Failed to persist synced tasks to AsyncStorage:', err);
    }
  };

  const applySyncedTasks = async (
    syncedTasks: CourseTask[],
    sourceLabel: 'Moodle' | 'Webwork',
    showAlert: boolean
  ) => {
    const { merged, newlyAddedCount } = mergeSyncedTasks(
      tasksRef.current,
      syncedTasks
    );

    if (syncedTasks.length > 0) {
      setTasks((prev) => mergeSyncedTasks(prev, syncedTasks).merged);
      await persistTasksSnapshot(merged);
    }

    if (showAlert) {
      if (syncedTasks.length === 0) {
        const msg = `0 upcoming tasks were found from ${sourceLabel}.`;
        showToastNotification(msg, 'warning');
        if (Platform.OS !== 'web') {
          Alert.alert(`${sourceLabel} Sync Complete`, msg);
        }
      } else {
        const icon = sourceLabel === 'Webwork' ? '💻' : '🎓';
        const msg = `Synced ${syncedTasks.length} assignment(s) from ${sourceLabel} (${newlyAddedCount} new added).`;
        showToastNotification(`${icon} ${msg}`, 'success');
        if (Platform.OS !== 'web') {
          Alert.alert(`${icon} ${sourceLabel} Sync Successful`, msg);
        }
      }
    }
  };

  // Shows both native Alert and Web-visible inline feedback/toast (since RN Web Alert.alert is a no-op)
  const notifyWebOrNative = (title: string, message: string, isError = false) => {
    setWebSyncFeedback({ message: `${title}: ${message}`, isError });
    showToastNotification(`${title} — ${message}`, isError ? 'warning' : 'success');
    if (Platform.OS !== 'web') {
      Alert.alert(title, message);
    }
  };

  // Opens external URL in a new browser tab on Web (or via Linking on Native)
  const openExternalBrowserUrl = (url: string) => {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.open === 'function'
    ) {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (opened) return;
    }
    Linking.openURL(url).catch(() =>
      notifyWebOrNative('Cannot Open Link', url, true)
    );
  };

  // Reads clipboard text into a state setter (works on Web & Native)
  const handlePasteFromClipboard = async (
    setter: (value: string) => void
  ): Promise<string> => {
    try {
      let clipText = '';
      if (
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.readText === 'function'
      ) {
        clipText = await navigator.clipboard.readText();
      } else {
        clipText = await Clipboard.getStringAsync();
      }
      if (clipText && clipText.trim()) {
        setWebSyncFeedback(null);
        setter(clipText);
        return clipText;
      }
      notifyWebOrNative(
        'Clipboard Empty',
        'No text was found in your clipboard. Copy the data first or paste manually (Ctrl+V).',
        true
      );
      return '';
    } catch {
      notifyWebOrNative(
        'Paste Manually',
        'Browser clipboard access was blocked. Tap the text box and press Ctrl+V (or long-press Paste).',
        true
      );
      return '';
    }
  };

  // Web/PWA: Process Moodle .ics file or copied Upcoming Events / JSON text
  const handleWebMoodleImportContent = async (rawContent: string) => {
    const syncedTasks = parseMoodleWebImportText(
      rawContent,
      eventsRef.current,
      catalogRef.current
    );
    if (syncedTasks.length === 0) {
      notifyWebOrNative(
        'No Moodle Tasks Found',
        'Could not detect Moodle assignments in this file or text. Try downloading icalexport.ics from Moodle Calendar Export or copying Upcoming Events.',
        true
      );
      return;
    }

    setWebSyncFeedback(null);
    setMoodleWebPasteText('');
    setMoodleModalVisible(false);
    await applySyncedTasks(syncedTasks, 'Moodle', true);
  };

  // Web/PWA: Trigger native browser file chooser for Moodle icalexport.ics
  const handlePickMoodleIcsFileOnWeb = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    setWebSyncFeedback(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ics,.ical,.txt,text/calendar';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        if (text) {
          handleWebMoodleImportContent(text);
        }
      };
      reader.onerror = () => {
        notifyWebOrNative(
          'File Read Error',
          'Could not read the selected .ics file.',
          true
        );
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Web/PWA: Parse copied WebWork assignment page text (supports ".Open. Due DD.MM.YYYY @ HH:MM" & tables)
  const handleWebWebworkImportContent = async (rawContent: string) => {
    const selectedGroup = webworkWebCourseKey
      ? activeCourseItems.find((c) => c.relationKey === webworkWebCourseKey)
      : undefined;
    const courseOverride: WebworkCourseOverride | null = selectedGroup
      ? {
          relationKey: selectedGroup.relationKey,
          courseId: selectedGroup.courseId,
          courseTitle: selectedGroup.title,
        }
      : null;

    const syncedTasks = parseWebworkTextInput(
      rawContent,
      eventsRef.current,
      catalogRef.current,
      courseOverride
    );

    if (syncedTasks.length === 0) {
      notifyWebOrNative(
        'No Open WebWork Assignments Found',
        'Make sure you copied the WebWork assignments page (e.g. "Open Assignments", "Open. Due DD.MM.YYYY @ HH:MM" or "Open, closes ...").',
        true
      );
      return;
    }

    setWebSyncFeedback(null);
    setWebworkWebPasteText('');
    setWebworkWebDropdownOpen(false);
    setWebworkModalVisible(false);
    await applySyncedTasks(syncedTasks, 'Webwork', true);
  };

  // WebView Moodle Task Sync Handlers (Native)
  const handleMoodleNavigationStateChange = (navState: WebViewNavigation) => {
    const url = navState.url || '';
    setMoodleCurrentUrl(url);

    // If the user is on a login or SSO URL, keep the WebView interactive and do not extract
    if (isMoodleLoginRedirectUrl(url)) {
      setMoodleSyncing(false);
      return;
    }

    if (!navState.loading && isMoodleAuthenticatedUrl(url)) {
      moodleWebViewRef.current?.injectJavaScript(MOODLE_INJECTED_SYNC_SCRIPT);
    }
  };

  const handleMoodleWebViewMessage = async (event: WebViewMessageEvent) => {
    const rawData = event.nativeEvent.data;
    if (!rawData) return;

    let parsedMsg: any = null;
    try {
      parsedMsg = JSON.parse(rawData);
    } catch {
      parsedMsg = null;
    }

    // Ignore or reset syncing state if the user is not yet logged in on the current page
    if (!parsedMsg || parsedMsg.type === 'MOODLE_NOT_LOGGED_IN') {
      setMoodleSyncing(false);
      return;
    }

    if (parsedMsg.type === 'MOODLE_MANUAL_SYNC_NOT_LOGGED_IN') {
      setMoodleSyncing(false);
      Alert.alert(
        'Login Required',
        'Please sign in to your Technion Moodle account first, then tap "Sync Now".'
      );
      return;
    }

    if (parsedMsg.type === 'MOODLE_SYNC_STARTED') {
      setMoodleSyncing(true);
      return;
    }

    setMoodleSyncing(false);

    if (parsedMsg.type === 'MOODLE_SYNC_ERROR') {
      Alert.alert(
        'Moodle Sync Error',
        parsedMsg.message || 'Could not fetch Moodle calendar tasks.'
      );
      return;
    }

    if (parsedMsg.type !== 'MOODLE_CALENDAR_DATA') {
      return;
    }

    const syncedTasks = parseMoodleSyncPayload(
      rawData,
      eventsRef.current,
      catalogRef.current
    );
    setMoodleModalVisible(false);
    await applySyncedTasks(syncedTasks, 'Moodle', true);
  };

  // Non-blocking Toast helper (native ToastAndroid on Android + floating in-app toast banner)
  const showToastNotification = (
    message: string,
    variant: 'success' | 'warning'
  ) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(
        message,
        variant === 'warning' ? ToastAndroid.LONG : ToastAndroid.SHORT
      );
    }
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastBanner({ message, variant });
    toastTimerRef.current = setTimeout(() => {
      setToastBanner(null);
      toastTimerRef.current = null;
    }, 4500);
  };

  // Silent Background Moodle Sync Handlers (runs on mount without blocking UI)
  const triggerBgMoodleExpiredNotice = () => {
    if (bgMoodleHandledRef.current) return;
    bgMoodleHandledRef.current = true;
    setBgMoodleSyncActive(false);

    if (autoOpenMoodleLoginRef.current) {
      // Automatically open the Moodle WebView modal so the user can authenticate via native OS Password Manager
      setMoodleSyncing(false);
      setMoodleCurrentUrl(MOODLE_LOGIN_URL);
      setMoodleModalVisible(true);
    } else {
      const expiredMsg = 'פג תוקף החיבור למודל. יש להתחבר מחדש דרך ההגדרות.';
      showToastNotification(expiredMsg, 'warning');
    }
  };

  const handleBgMoodleNavigationStateChange = (navState: WebViewNavigation) => {
    if (bgMoodleHandledRef.current) return;
    const url = navState.url || '';
    if (!url) return;

    // Detect redirect to Moodle login page or SSO (session cookie expired)
    if (isMoodleLoginRedirectUrl(url)) {
      triggerBgMoodleExpiredNotice();
      return;
    }

    if (!navState.loading) {
      bgMoodleWebViewRef.current?.injectJavaScript(
        MOODLE_BG_INJECTED_SYNC_SCRIPT
      );
    }
  };

  const handleBgMoodleMessage = async (event: WebViewMessageEvent) => {
    if (bgMoodleHandledRef.current) return;
    const rawData = event.nativeEvent.data;
    if (!rawData) return;

    let parsedMsg: any = null;
    try {
      parsedMsg = JSON.parse(rawData);
    } catch {
      parsedMsg = null;
    }

    if (
      !parsedMsg ||
      parsedMsg.type === 'MOODLE_BG_AUTH_EXPIRED' ||
      parsedMsg.type === 'MOODLE_SYNC_ERROR'
    ) {
      triggerBgMoodleExpiredNotice();
      return;
    }

    bgMoodleHandledRef.current = true;
    setBgMoodleSyncActive(false);

    const syncedTasks = parseMoodleSyncPayload(
      rawData,
      eventsRef.current,
      catalogRef.current
    );
    await applySyncedTasks(syncedTasks, 'Moodle', false);

    showToastNotification('המטלות סונכרנו בהצלחה', 'success');
  };

  // WebView Webwork Task Sync Handlers (Moodle SSO -> Course -> Webwork Domain)
  const handleWebworkNavigationStateChange = (navState: WebViewNavigation) => {
    const url = navState.url || '';
    setWebworkCurrentUrl(url);

    if (navState.loading) return;

    const lower = url.toLowerCase();

    // 1. If the user is on Moodle (login, dashboard, or course page), DO NOT close or extract;
    //    inject only the navigation helper so LTI / target="_blank" Webwork links open in-place.
    if (lower.includes('moodle.technion')) {
      setWebworkSyncing(false);
      webworkWebViewRef.current?.injectJavaScript(
        WEBWORK_MOODLE_NAVIGATION_HELPER_SCRIPT
      );
      return;
    }

    // 2. ONLY when the WebView lands on a Webwork domain ("webwork.technion", "ww", "/webwork2"),
    //    inject the Webwork assignment extraction script.
    if (isWebworkAuthenticatedUrl(url)) {
      setWebworkSyncing(true);
      webworkWebViewRef.current?.injectJavaScript(WEBWORK_INJECTED_SYNC_SCRIPT);
    }
  };

  const handleWebworkWebViewMessage = async (event: WebViewMessageEvent) => {
    const rawData = event.nativeEvent.data;
    if (!rawData) return;

    setWebworkSyncing(false);

    let parsedPayload: any = null;
    try {
      parsedPayload = JSON.parse(rawData);
    } catch {
      parsedPayload = null;
    }

    if (parsedPayload && parsedPayload.type === 'WEBWORK_NO_TASKS_YET') {
      return;
    }

    const syncedTasks = parseWebworkSyncPayload(
      rawData,
      eventsRef.current,
      catalogRef.current
    );
    if (syncedTasks.length === 0) {
      if (parsedPayload && parsedPayload.manual) {
        Alert.alert(
          'Webwork Sync',
          'No open Webwork problem sets were found on this page yet. Navigate to your course problem sets page in Webwork and tap "Sync Now".'
        );
      }
      return;
    }

    await applySyncedTasks(syncedTasks, 'Webwork', true);
    // Close the Webwork WebView modal ONLY after tasks are extracted and saved
    setWebworkModalVisible(false);
  };

  // Feature 6: PWA-Compatible Schedule Export/Import via Clipboard & TextInput
  const handleExportLocalState = async () => {
    try {
      setBackupBusy(true);
      const payload: LocalBackupPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        events,
        tasks,
        desiredCourseIds,
        lockedEvents,
        hiddenKeys,
        includedSpecialGroups,
        autoOpenMoodleLogin,
      };

      const jsonText = JSON.stringify(payload, null, 2);
      await Clipboard.setStringAsync(jsonText);

      showToastNotification(
        'Backup JSON copied to clipboard! Ready to paste on another device.',
        'success'
      );
      Alert.alert(
        '📤 Schedule Copied to Clipboard',
        'Your schedule and tasks backup JSON has been copied to the clipboard and is ready to be pasted on another device.'
      );
    } catch (err: any) {
      Alert.alert(
        'Export Error',
        err?.message || 'Failed to copy schedule backup JSON to clipboard.'
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleLoadBackupFromText = async () => {
    const rawText = importJsonText.trim();
    if (!rawText) {
      Alert.alert(
        'Invalid Backup Data',
        'Please paste your exported schedule JSON string before loading.'
      );
      return;
    }

    try {
      setBackupBusy(true);
      const parsed = JSON.parse(rawText) as Partial<LocalBackupPayload>;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (!Array.isArray(parsed.events) && !Array.isArray(parsed.tasks))
      ) {
        throw new Error('Missing valid schedule or tasks arrays.');
      }

      const incomingEvents = Array.isArray(parsed.events) ? parsed.events : [];
      const incomingTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const incomingDesired = Array.isArray(parsed.desiredCourseIds)
        ? parsed.desiredCourseIds
        : [];
      const incomingLocked = Array.isArray(parsed.lockedEvents)
        ? parsed.lockedEvents
        : [];
      const nextHiddenKeys =
        parsed.hiddenKeys && typeof parsed.hiddenKeys === 'object'
          ? parsed.hiddenKeys
          : {};
      const nextSpecialGroups =
        parsed.includedSpecialGroups &&
        typeof parsed.includedSpecialGroups === 'object'
          ? { ...includedSpecialGroups, ...parsed.includedSpecialGroups }
          : includedSpecialGroups;
      const nextAutoOpenMoodle =
        typeof parsed.autoOpenMoodleLogin === 'boolean'
          ? parsed.autoOpenMoodleLogin
          : autoOpenMoodleLogin;

      setEvents(incomingEvents);
      setTasks(incomingTasks);
      setDesiredCourseIds(incomingDesired);
      setLockedEvents(incomingLocked);
      setHiddenKeys(nextHiddenKeys);
      setIncludedSpecialGroups(nextSpecialGroups);
      setAutoOpenMoodleLogin(nextAutoOpenMoodle);
      autoOpenMoodleLoginRef.current = nextAutoOpenMoodle;

      const restoredPayload: LocalBackupPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        events: incomingEvents,
        tasks: incomingTasks,
        desiredCourseIds: incomingDesired,
        lockedEvents: incomingLocked,
        hiddenKeys: nextHiddenKeys,
        includedSpecialGroups: nextSpecialGroups,
        autoOpenMoodleLogin: nextAutoOpenMoodle,
      };
      await AsyncStorage.setItem(
        ASYNC_STORAGE_KEY,
        JSON.stringify(restoredPayload)
      );

      setImportJsonText('');
      setBackupModalVisible(false);

      showToastNotification('Schedule backup restored!', 'success');
      Alert.alert(
        '📥 Backup Loaded Successfully',
        `Restored ${incomingEvents.length} event(s) and ${incomingTasks.length} task(s) to your schedule.`
      );
    } catch {
      Alert.alert(
        'Invalid Backup Data',
        'The pasted text is not a valid MeatSpoon backup JSON. Please verify the copied data and try again.'
      );
    } finally {
      setBackupBusy(false);
    }
  };

  // "Free Time" Spontaneous Finder ("יש לי זמן פנוי")
  const handleOpenFreeTimeFinder = () => {
    const now = new Date();
    setFreeTimeCheckedAt(now);

    const currentDay = now.getDay(); // 0 = Sun .. 6 = Sat
    const currentDecHour = now.getHours() + now.getMinutes() / 60;
    const windowEndHour = currentDecHour + 2.0;

    const results: SpontaneousEventItem[] = [];
    const seenKeys = new Set<string>();

    // 1. Check all catalog groups of the user's tracked courses (merged identical groups)
    for (const cid of trackedCourseIds) {
      const course = catalog.find((c) => c.courseId === cid);
      if (!course) continue;

      const userEvForCourse = events.find((e) => e.courseId === cid);
      const color = userEvForCourse ? userEvForCourse.color : '#2563EB';

      const allowedGroups = course.groups.filter((g) =>
        isGroupAllowedByFilters(g.groupId, includedSpecialGroups)
      );
      const mergedGroups = mergeIdenticalCourseGroups(allowedGroups);

      for (const grp of mergedGroups) {
        for (const sess of grp.sessions) {
          if (
            sess.day === currentDay &&
            sess.startHour >= currentDecHour &&
            sess.startHour <= windowEndHour
          ) {
            const dedupeKey = `${cid}-${grp.type}-${grp.groupId}-${sess.day}-${sess.startHour}`;
            if (seenKeys.has(dedupeKey)) continue;
            seenKeys.add(dedupeKey);

            const minsUntil = Math.max(
              0,
              Math.round((sess.startHour - currentDecHour) * 60)
            );
            results.push({
              key: dedupeKey,
              courseId: course.courseId,
              courseName: course.name,
              type: grp.type,
              groupId: grp.groupId,
              lecturer: grp.lecturer,
              location: sess.location || 'TBA',
              startHour: sess.startHour,
              endHour: sess.endHour,
              minutesUntilStart: minsUntil,
              color,
            });
          }
        }
      }
    }

    // 2. Also check events directly in the user's schedule state
    for (const ev of events) {
      if (ev.type === 'Custom' || ev.type === 'Exam') continue;
      if (
        ev.day === currentDay &&
        ev.startHour >= currentDecHour &&
        ev.startHour <= windowEndHour
      ) {
        const dedupeKey = `${ev.courseId || ev.title}-${ev.type}-${
          ev.groupId || ''
        }-${ev.day}-${ev.startHour}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        const minsUntil = Math.max(
          0,
          Math.round((ev.startHour - currentDecHour) * 60)
        );
        results.push({
          key: dedupeKey,
          courseId: ev.courseId || '',
          courseName: ev.title,
          type: ev.type,
          groupId: ev.groupId || '—',
          lecturer: ev.lecturer || 'TBA',
          location: ev.location || 'TBA',
          startHour: ev.startHour,
          endHour: ev.endHour,
          minutesUntilStart: minsUntil,
          color: ev.color,
        });
      }
    }

    results.sort((a, b) => a.minutesUntilStart - b.minutesUntilStart);
    setSpontaneousEvents(results);
    setFreeTimeModalVisible(true);
  };

  // Handle Single Tap (Highlight) vs Double Tap (Visibility Toggle: isHidden) on "My Courses" items
  const handleMyCourseItemPress = (relationKey: string) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 280;

    if (
      lastTapRef.current.key === relationKey &&
      now - lastTapRef.current.time < DOUBLE_TAP_DELAY
    ) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = { key: '', time: 0 };

      setHiddenKeys((prev) => ({
        ...prev,
        [relationKey]: !prev[relationKey],
      }));
    } else {
      lastTapRef.current = { key: relationKey, time: now };
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
      singleTapTimerRef.current = setTimeout(() => {
        setHighlightedKey((prev) => (prev === relationKey ? null : relationKey));
        singleTapTimerRef.current = null;
      }, DOUBLE_TAP_DELAY);
    }
  };

  // Toggle Special Group Filter Chip
  const toggleSpecialGroupFilter = (filterId: string) => {
    setIncludedSpecialGroups((prev) => ({
      ...prev,
      [filterId]: !prev[filterId],
    }));
  };

  // Fetch & parse https://sap.cheesefork.cf/courses_2026_200.min.js
  const handleSyncCheesefork = async () => {
    try {
      setLoadingLiveCatalog(true);
      const liveCourses = await fetchCheeseforkCatalog();
      setCatalog(liveCourses);
      Alert.alert(
        'Cheesefork Synced',
        `Loaded ${liveCourses.length} Technion courses (with exam dates) from live Cheesefork data.`
      );
    } catch (err: any) {
      Alert.alert(
        'Sync Error',
        err.message || 'Could not fetch Cheesefork JS course data.'
      );
    } finally {
      setLoadingLiveCatalog(false);
    }
  };

  const toggleExpandCourse = (courseId: string) => {
    setExpandedCourseId((prev) => (prev === courseId ? null : courseId));
  };

  // Check whether a specific (possibly merged) course group is currently in the user's schedule
  const isCourseGroupAdded = (
    courseId: string,
    group: CourseCatalogItem['groups'][0]
  ): boolean => {
    const rawIds = group.rawGroupIds || [];
    return events.some((e) => {
      if (e.courseId !== courseId || e.type !== group.type) return false;
      if (e.groupId === group.groupId) return true;
      const cleanEventGroup = (e.groupId || '').replace(/[\[\]]/g, '').trim();
      return rawIds.includes(cleanEventGroup);
    });
  };

  // Persistent Toggle: Add or Remove a Course Group without confirmation alerts or duplicates
  const toggleCourseGroup = (
    course: CourseCatalogItem,
    group: CourseCatalogItem['groups'][0],
    defaultColor: string
  ) => {
    const alreadyAdded = isCourseGroupAdded(course.courseId, group);
    const rawIds = group.rawGroupIds || [];

    const matchesGroupEvent = (e: ScheduleEvent) => {
      if (e.courseId !== course.courseId || e.type !== group.type) return false;
      if (e.groupId === group.groupId) return true;
      const cleanEventGroup = (e.groupId || '').replace(/[\[\]]/g, '').trim();
      return rawIds.includes(cleanEventGroup);
    };

    if (alreadyAdded) {
      setEvents((prev) => prev.filter((e) => !matchesGroupEvent(e)));
    } else {
      const existingCourseEvent = events.find(
        (e) => e.courseId === course.courseId
      );
      const syncedColor = existingCourseEvent
        ? existingCourseEvent.color
        : defaultColor;

      setEvents((prev) => {
        const filtered = prev.filter((e) => !matchesGroupEvent(e));
        const newInstances: ScheduleEvent[] = group.sessions.map((s, idx) => ({
          id: `${course.courseId}-${group.type}-${group.groupId}-${s.day}-${s.startHour}-${idx}`,
          courseId: course.courseId,
          title: course.name,
          type: group.type,
          groupId: group.groupId,
          lecturer: group.lecturer,
          location: s.location,
          day: s.day,
          startHour: s.startHour,
          endHour: s.endHour,
          color: syncedColor,
        }));
        return [...filtered, ...newInstances];
      });
    }
  };

  // Option 1: Remove ONLY the tapped event instance
  const deleteSingleEventInstance = (eventId: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    setSelectedEvent(null);
  };

  // Option 2: Remove ALL related events sharing the same courseId or custom groupId
  const deleteAllRelatedEvents = (targetEvent: ScheduleEvent) => {
    const targetKey = getEventRelationKey(targetEvent);
    setEvents((prev) =>
      prev.filter((e) => getEventRelationKey(e) !== targetKey)
    );
    if (highlightedKey === targetKey) {
      setHighlightedKey(null);
    }
    setSelectedEvent(null);
  };

  // Color Sync — Apply new color to ALL related events sharing the same course/group relation key
  const updateEventColor = (targetEvent: ScheduleEvent, newColor: string) => {
    const targetKey = getEventRelationKey(targetEvent);
    setEvents((prev) =>
      prev.map((e) =>
        getEventRelationKey(e) === targetKey ? { ...e, color: newColor } : e
      )
    );
    setSelectedEvent((prev) => (prev ? { ...prev, color: newColor } : null));
  };

  // Custom Event Creation with explicit "Create New Group" vs existing group assignment
  const handleAddCustomEvent = () => {
    const start = parseFloat(customStart);
    const end = parseFloat(customEnd);
    const trimmedTitle = customTitle.trim();
    if (!trimmedTitle || isNaN(start) || isNaN(end) || end <= start) {
      Alert.alert(
        'Invalid Input',
        'Please enter a valid title and start/end hours.'
      );
      return;
    }

    const assignedGroup = activeCourseItems.find(
      (item) => item.relationKey === customAssignedRelationKey
    );

    let eventCourseId: string | undefined = undefined;
    let eventGroupId: string;
    let eventColor: string;
    let groupDisplayName: string;

    if (assignedGroup) {
      eventCourseId = assignedGroup.courseId;
      eventGroupId =
        assignedGroup.groupId ||
        assignedGroup.relationKey.replace(/^custom:/, '');
      eventColor = assignedGroup.color;
      groupDisplayName = assignedGroup.title;
    } else {
      eventCourseId = undefined;
      eventGroupId = `custom-group-${Date.now()}`;
      eventColor = customColor;
      groupDisplayName = trimmedTitle;
    }

    const customEv: ScheduleEvent = {
      id: `custom-ev-${Date.now()}`,
      courseId: eventCourseId,
      groupId: eventGroupId,
      title: trimmedTitle,
      type: 'Custom',
      lecturer: groupDisplayName,
      location: 'Custom',
      day: customDay,
      startHour: start,
      endHour: end,
      color: eventColor,
    };

    setEvents((prev) => [...prev, customEv]);
    setCustomTitle('');
    setCustomAssignedRelationKey(null);
    setGroupDropdownOpen(false);
    setCustomModalVisible(false);
  };

  // Auto-Builder: Toggle desired course selection
  const toggleDesiredCourse = (courseId: string) => {
    setDesiredCourseIds((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId]
    );
    setHasRunAutoBuilder(false);
  };

  // Auto-Builder: Add a mandatory locked event block
  const handleAddLockedEvent = () => {
    const start = parseFloat(lockStart);
    const end = parseFloat(lockEnd);
    const trimmed = lockTitle.trim() || 'Locked Block';
    if (isNaN(start) || isNaN(end) || end <= start) {
      Alert.alert('Invalid Time', 'Please enter valid start and end hours.');
      return;
    }

    const newLock: ScheduleEvent = {
      id: `locked-${Date.now()}`,
      groupId: `locked-group-${Date.now()}`,
      title: trimmed,
      type: 'Custom',
      lecturer: 'Mandatory Locked',
      location: 'Locked',
      day: lockDay,
      startHour: start,
      endHour: end,
      color: '#374151',
    };

    setLockedEvents((prev) => [...prev, newLock]);
    setLockTitle('');
    setHasRunAutoBuilder(false);
  };

  // Auto-Builder: Import existing custom events from main schedule as locked events
  const handleImportCurrentCustomAsLocked = () => {
    const customFromSchedule = events.filter((e) => e.type === 'Custom');
    if (customFromSchedule.length === 0) {
      Alert.alert(
        'No Custom Events',
        'You have no custom events on your main calendar to lock.'
      );
      return;
    }
    setLockedEvents((prev) => {
      const existingIds = new Set(prev.map((e) => e.id));
      const toAdd = customFromSchedule.filter((e) => !existingIds.has(e.id));
      return [...prev, ...toAdd];
    });
    setHasRunAutoBuilder(false);
  };

  // Auto-Builder: Run deterministic backtracking solver (using merged identical groups)
  const handleRunAutoBuilder = () => {
    if (desiredCourseIds.length === 0) {
      Alert.alert(
        'Select Courses',
        'Please select at least 1 desired course to build a schedule.'
      );
      return;
    }

    const selectedCourses: CourseCatalogItem[] = desiredCourseIds
      .map((id) => catalog.find((c) => c.courseId === id))
      .filter((c): c is CourseCatalogItem => Boolean(c))
      .map((course) => {
        const allowed = course.groups.filter((g) =>
          isGroupAllowedByFilters(g.groupId, includedSpecialGroups)
        );
        return {
          ...course,
          groups: mergeIdenticalCourseGroups(allowed),
        };
      });

    const options = generateAutoSchedules(
      selectedCourses,
      lockedEvents,
      COLOR_PALETTE,
      2
    );
    setGeneratedOptions(options);
    setHasRunAutoBuilder(true);
  };

  // Auto-Builder: Apply chosen option to main calendar state
  const handleSelectGeneratedSchedule = (option: GeneratedScheduleOption) => {
    setEvents(option.events);
    setHighlightedKey(null);
    setHiddenKeys({});
    setAutoBuilderModalVisible(false);
  };

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  // Feature 2: Filter catalog by search query, apply special group filters, AND merge identical groups
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog
      .map((course) => {
        const matchesQuery =
          !q ||
          course.name.toLowerCase().includes(q) ||
          course.courseId.toLowerCase().includes(q);
        if (!matchesQuery) return null;

        const filteredGroups = course.groups.filter((g) =>
          isGroupAllowedByFilters(g.groupId, includedSpecialGroups)
        );

        if (course.groups.length > 0 && filteredGroups.length === 0) {
          return null;
        }

        // Merge groups sharing the exact same instructor, session times, and room into "[10], [11], [12]"
        const mergedGroups = mergeIdenticalCourseGroups(filteredGroups);

        return {
          ...course,
          groups: mergedGroups,
        };
      })
      .filter((c): c is CourseCatalogItem => c !== null);
  }, [catalog, searchQuery, includedSpecialGroups]);

  // Filter catalog inside Auto-Builder search
  const autoFilteredCatalog = useMemo(() => {
    const q = autoSearchQuery.trim().toLowerCase();
    if (!q) return catalog.slice(0, 30);
    return catalog
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.courseId.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [catalog, autoSearchQuery]);

  const selectedAssignedGroup = activeCourseItems.find(
    (item) => item.relationKey === customAssignedRelationKey
  );

  const selectedTaskGroup =
    activeCourseItems.find((item) => item.relationKey === taskRelationKey) ||
    activeCourseItems[0] ||
    null;

  const weekStartLabel = currentWeekDates[0]?.shortLabel || '';
  const weekEndLabel = currentWeekDates[4]?.shortLabel || '';
  const weekYearLabel = currentWeekSunday.getFullYear();

  if (isHydratingStorage) {
    return (
      <SafeAreaProvider>
        <SafeAreaView
          style={[
            styles.container,
            { justifyContent: 'center', alignItems: 'center' },
          ]}
          edges={['top', 'left', 'right', 'bottom']}
        >
          <StatusBar style="light" />
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={{ color: '#E5E7EB', marginTop: 12, fontSize: 13 }}>
            Loading saved schedule...
          </Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="light" />
        {/* TOP ACTION BAR: SINGLE SPOON ("🥄") MENU BUTTON */}
        <View style={styles.header}>
          {pixelsPerHour !== DEFAULT_PIXELS_PER_HOUR && (
            <TouchableOpacity
              style={styles.zoomResetBadge}
              onPress={() => setPixelsPerHour(DEFAULT_PIXELS_PER_HOUR)}
            >
              <Text style={styles.zoomResetText}>
                {Math.round((pixelsPerHour / DEFAULT_PIXELS_PER_HOUR) * 100)}% ↺
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.spoonMenuBtn}
            activeOpacity={0.8}
            onPress={() => setSpoonMenuVisible((prev) => !prev)}
          >
            <Text style={styles.spoonMenuEmoji}>🥄</Text>
          </TouchableOpacity>
        </View>

        {/* SPOON DROPDOWN MENU */}
        <Modal
          visible={spoonMenuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSpoonMenuVisible(false)}
        >
          <TouchableOpacity
            style={styles.spoonMenuBackdrop}
            activeOpacity={1}
            onPress={() => setSpoonMenuVisible(false)}
          >
            <View style={styles.spoonDropdownMenu}>
              <TouchableOpacity
                style={styles.spoonMenuItem}
                onPress={() => {
                  setSpoonMenuVisible(false);
                  setAutoBuilderModalVisible(true);
                }}
              >
                <Text style={styles.spoonMenuItemText}>🪄 Auto</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.spoonMenuItem}
                onPress={() => {
                  setSpoonMenuVisible(false);
                  setSearchModalVisible(true);
                }}
              >
                <Text style={styles.spoonMenuItemText}>📚 Courses</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.spoonMenuItem}
                onPress={() => {
                  setSpoonMenuVisible(false);
                  setGroupDropdownOpen(false);
                  setCustomModalVisible(true);
                }}
              >
                <Text style={styles.spoonMenuItemText}>✏️ Custom</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.spoonMenuItem}
                onPress={() => {
                  setSpoonMenuVisible(false);
                  handleOpenTaskModal();
                }}
              >
                <Text style={styles.spoonMenuItemText}>📝 Task</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.spoonMenuItem}
                onPress={() => {
                  setSpoonMenuVisible(false);
                  handleOpenFreeTimeFinder();
                }}
              >
                <Text style={styles.spoonMenuItemText}>🕒 Free Time</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.spoonMenuItem, { borderBottomWidth: 0 }]}
                onPress={() => {
                  setSpoonMenuVisible(false);
                  setSettingsModalVisible(true);
                }}
              >
                <Text style={styles.spoonMenuItemText}>⚙️ Settings</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* UNIFIED "⚙️ SETTINGS" MODAL (OPENED FROM THE 🥄 DROPDOWN MENU) */}
        <Modal
          visible={settingsModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSettingsModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.settingsModalCard}>
              {/* Settings Modal Header */}
              <View style={styles.settingsHeaderRow}>
                <View>
                  <Text style={styles.settingsHeaderTitle}>⚙️ Settings</Text>
                  <Text style={styles.settingsHeaderSubtitle}>
                    Sync assignments, manage schedule backups & app info
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSettingsModalVisible(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.settingsHeaderCloseIcon}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ maxHeight: 420 }}
                showsVerticalScrollIndicator={false}
              >
                {/* SECTION 1: ACADEMIC SYNC */}
                <Text style={styles.settingsSectionLabel}>
                  ACADEMIC ASSIGNMENTS SYNC
                </Text>
                <View style={styles.settingsGroupBox}>
                  <TouchableOpacity
                    style={styles.settingsOptionRow}
                    onPress={() => {
                      setSettingsModalVisible(false);
                      setMoodleSyncing(false);
                      setWebSyncFeedback(null);
                      setMoodleWebPasteText('');
                      setMoodleCurrentUrl(MOODLE_LOGIN_URL);
                      setMoodleModalVisible(true);
                    }}
                  >
                    <Text style={styles.settingsOptionText}>🎓 Sync Moodle</Text>
                    <Text style={styles.settingsOptionChevron}>›</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.settingsOptionRow}
                    onPress={() => {
                      setSettingsModalVisible(false);
                      setWebworkSyncing(false);
                      setWebSyncFeedback(null);
                      setWebworkWebPasteText('');
                      setWebworkWebDropdownOpen(false);
                      setWebworkCurrentUrl(WEBWORK_LOGIN_URL);
                      setWebworkModalVisible(true);
                    }}
                  >
                    <Text style={styles.settingsOptionText}>
                      💻 Sync Webwork
                    </Text>
                    <Text style={styles.settingsOptionChevron}>›</Text>
                  </TouchableOpacity>

                  <View
                    style={[
                      styles.settingsOptionRow,
                      styles.settingsOptionRowLast,
                    ]}
                  >
                    <Text
                      style={[
                        styles.settingsOptionText,
                        styles.settingsToggleLabelText,
                      ]}
                    >
                      פתח מסך התחברות אוטומטית כשהחיבור למודל פג
                    </Text>
                    <Switch
                      value={autoOpenMoodleLogin}
                      onValueChange={(val) => {
                        setAutoOpenMoodleLogin(val);
                        autoOpenMoodleLoginRef.current = val;
                      }}
                      trackColor={{ false: '#374151', true: '#2563EB' }}
                      thumbColor={autoOpenMoodleLogin ? '#FFFFFF' : '#9CA3AF'}
                    />
                  </View>
                </View>

                {/* SECTION 2: SCHEDULE BACKUP (JSON IMPORT / EXPORT) */}
                <Text style={styles.settingsSectionLabel}>
                  SCHEDULE DATA & BACKUP
                </Text>
                <View style={styles.settingsGroupBox}>
                  <TouchableOpacity
                    style={styles.settingsOptionRow}
                    disabled={backupBusy}
                    onPress={() => {
                      setSettingsModalVisible(false);
                      setImportJsonText('');
                      setBackupModalVisible(true);
                    }}
                  >
                    <Text style={styles.settingsOptionText}>
                      📥 Import Schedule
                    </Text>
                    <Text style={styles.settingsOptionChevron}>›</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.settingsOptionRow,
                      styles.settingsOptionRowLast,
                    ]}
                    disabled={backupBusy}
                    onPress={() => {
                      setSettingsModalVisible(false);
                      handleExportLocalState();
                    }}
                  >
                    <Text style={styles.settingsOptionText}>
                      📤 Export Schedule
                    </Text>
                    <Text style={styles.settingsOptionChevron}>›</Text>
                  </TouchableOpacity>
                </View>

                {/* SECTION 3: APP INFORMATION */}
                <Text style={styles.settingsSectionLabel}>INFORMATION</Text>
                <View style={styles.settingsGroupBox}>
                  <TouchableOpacity
                    style={[
                      styles.settingsOptionRow,
                      styles.settingsOptionRowLast,
                    ]}
                    onPress={() => {
                      setSettingsModalVisible(false);
                      setAboutModalVisible(true);
                    }}
                  >
                    <Text style={styles.settingsOptionText}>ℹ️ About</Text>
                    <Text style={styles.settingsOptionChevron}>›</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>

              {/* Prominent Close Button */}
              <TouchableOpacity
                style={styles.settingsCloseBtn}
                activeOpacity={0.85}
                onPress={() => setSettingsModalVisible(false)}
              >
                <Text style={styles.settingsCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* REAL-DATE WEEK BAR & TRACKED EXAM DATES JUMP BAR */}
        <View style={styles.dateNavigationBar}>
          <View style={styles.dateNavRow}>
            <TouchableOpacity
              style={styles.weekNavBtn}
              onPress={() => shiftWeek(-1)}
            >
              <Text style={styles.weekNavBtnText}>◀ Prev</Text>
            </TouchableOpacity>

            <View style={styles.weekRangeCenter}>
              <Text style={styles.weekRangeTitle}>
                📅 {weekStartLabel} – {weekEndLabel}/{weekYearLabel} (RTL: Sun ➔)
              </Text>
              <TouchableOpacity
                style={styles.todayChip}
                onPress={() =>
                  setCurrentWeekSunday(getStartOfWeekSunday(new Date()))
                }
              >
                <Text style={styles.todayChipText}>Today</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.weekNavBtn}
              onPress={() => shiftWeek(1)}
            >
              <Text style={styles.weekNavBtnText}>Next ▶</Text>
            </TouchableOpacity>
          </View>

          {/* Tracked Course Exams Strip (Tap any exam to jump to its calendar week) */}
          {trackedExams.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.examChipsRow}
            >
              {trackedExams.map((ex) => {
                const isThisWeek = currentWeekExamEvents.some(
                  (e) => e.id === ex.id
                );
                return (
                  <TouchableOpacity
                    key={ex.id}
                    onPress={() => jumpToDateISO(ex.dateISO)}
                    style={[
                      styles.examJumpChip,
                      isThisWeek && styles.examJumpChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.examJumpChipText,
                        isThisWeek && { color: '#fff' },
                      ]}
                    >
                      📝 {ex.courseId} {ex.moedLabel}: {ex.displayDate}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* RESPONSIVE MAIN BODY: Column in Portrait, Row in Landscape */}
        <View
          style={[
            styles.contentContainer,
            isLandscape && styles.contentContainerLandscape,
          ]}
        >
          {/* MAIN CALENDAR AREA WITH SWIPE GESTURES, SLIDE ANIMATION & VERTICAL PINCH-TO-ZOOM */}
          <Animated.View
            style={[
              styles.calendarMainArea,
              {
                transform: [{ translateX: weekSlideAnim }],
                opacity: weekOpacityAnim,
              },
            ]}
            {...pinchPanResponder.panHandlers}
          >
            {/* FEATURE 1: RTL DATE-AWARE DAY HEADERS + PINNED ALL-DAY COURSE TASKS (Thu on left ... Sun on far right) */}
            <View style={styles.dayHeaderRow}>
              <View style={styles.timeGutterHeader} />
              {RTL_DAY_INDICES.map((dayIndex) => {
                const dayName = DAYS[dayIndex];
                const colDate = currentWeekDates[dayIndex];
                const isToday = colDate?.dateISO === todayISO;
                const hasExamOnDay = currentWeekExamEvents.some(
                  (e) => e.day === dayIndex
                );
                const dayTasks = (currentWeekTasksByDay[dayIndex] || []).filter(
                  (t) => !hiddenKeys[t.relationKey]
                );

                return (
                  <View
                    key={dayName}
                    style={[
                      styles.dayHeaderCell,
                      isToday && styles.dayHeaderCellToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayHeaderText,
                        isToday && styles.dayHeaderTextToday,
                      ]}
                    >
                      {dayName} {hasExamOnDay ? '📝' : ''}
                    </Text>
                    <Text
                      style={[
                        styles.dayDateSubText,
                        isToday && styles.dayHeaderTextToday,
                      ]}
                    >
                      {colDate?.shortLabel}
                    </Text>

                    {/* Pinned all-day tasks at the top of the day column matching course color */}
                    {dayTasks.length > 0 && (
                      <View style={styles.pinnedDayTasksContainer}>
                        {dayTasks.map((tsk) => {
                          const dueDate = new Date(tsk.deadlineISO);
                          const dueTimeStr = !Number.isNaN(dueDate.getTime())
                            ? `${dueDate
                                .getHours()
                                .toString()
                                .padStart(2, '0')}:${dueDate
                                .getMinutes()
                                .toString()
                                .padStart(2, '0')}`
                            : '';
                          return (
                            <TouchableOpacity
                              key={tsk.id}
                              activeOpacity={0.85}
                              onPress={() => setSelectedTask(tsk)}
                              style={[
                                styles.pinnedDayTaskChip,
                                { backgroundColor: tsk.color },
                              ]}
                            >
                              <Text
                                style={styles.pinnedDayTaskChipText}
                                numberOfLines={1}
                              >
                                📌 {tsk.title}
                                {dueTimeStr ? ` (${dueTimeStr})` : ''}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {/* WEEKLY SCHEDULE GRID WITH RTL COLUMNS, TAP-TO-CREATE & CURRENT TIME INDICATOR */}
            <ScrollView
              style={styles.gridScroll}
              scrollEnabled={!isPinching}
            >
              <View style={styles.gridContainer}>
                {/* Left Time Column */}
                <View style={styles.timeGutter}>
                  {hours.map((h) => (
                    <View
                      key={h}
                      style={[styles.timeCell, { height: pixelsPerHour }]}
                    >
                      <Text style={styles.timeText}>{`${h}:00`}</Text>
                    </View>
                  ))}
                </View>

                {/* Feature 1: 5 Day Columns rendered RTL (Thursday = 4 on left, Sunday = 0 on far right) */}
                {RTL_DAY_INDICES.map((dayIndex) => {
                  const visibleRegularEvents = events.filter(
                    (e) =>
                      e.day === dayIndex &&
                      !hiddenKeys[getEventRelationKey(e)]
                  );
                  const visibleExamEvents = currentWeekExamEvents.filter(
                    (e) =>
                      e.day === dayIndex &&
                      !hiddenKeys[getEventRelationKey(e)]
                  );
                  const visibleTaskEvents = currentWeekTaskEvents.filter(
                    (e) =>
                      e.day === dayIndex &&
                      !hiddenKeys[getEventRelationKey(e)]
                  );

                  const combinedDayEvents = [
                    ...visibleRegularEvents,
                    ...visibleExamEvents,
                    ...visibleTaskEvents,
                  ];
                  const positionedEvents = layoutDayEvents(combinedDayEvents);

                  return (
                    <View key={dayIndex} style={styles.dayColumn}>
                      {/* Feature 3: Pressable empty hour slots to open Custom Event modal with pre-filled times */}
                      {hours.map((h) => (
                        <TouchableOpacity
                          key={h}
                          activeOpacity={0.6}
                          onPress={(evt) => handleEmptySlotTap(dayIndex, h, evt)}
                          style={[styles.gridCell, { height: pixelsPerHour }]}
                        />
                      ))}

                      {/* Rendered Schedule, Exam & Task Blocks in 4-Line Format */}
                      {positionedEvents.map((ev) => {
                        const top = (ev.startHour - START_HOUR) * pixelsPerHour;
                        const height = (ev.endHour - ev.startHour) * pixelsPerHour;
                        const widthPct = 100 / ev.totalCols;
                        const leftPct = ev.colIndex * widthPct;

                        const relationKey = getEventRelationKey(ev);
                        const isHighlighted =
                          highlightedKey !== null && highlightedKey === relationKey;
                        const isDimmed =
                          highlightedKey !== null && highlightedKey !== relationKey;
                        const isExam = ev.type === 'Exam';
                        const isTask = ev.type === 'Task';

                        return (
                          <TouchableOpacity
                            key={ev.id}
                            activeOpacity={0.85}
                            onPress={() => {
                              if (isTask && ev.taskId) {
                                const foundTask = tasks.find(
                                  (t) => t.id === ev.taskId
                                );
                                if (foundTask) {
                                  setSelectedTask(foundTask);
                                  return;
                                }
                              }
                              setSelectedEvent(ev);
                            }}
                            style={[
                              styles.eventBlock,
                              {
                                top,
                                height: Math.max(height - 2, 22),
                                width: `${widthPct}%`,
                                left: `${leftPct}%`,
                                backgroundColor: ev.color,
                                opacity: isDimmed ? 0.2 : 1,
                              },
                              isExam && styles.examEventBlock,
                              isTask && styles.taskEventBlock,
                              isHighlighted && styles.eventBlockHighlighted,
                            ]}
                          >
                            <Text style={styles.eventTitle} numberOfLines={1}>
                              {ev.title}
                            </Text>
                            <Text style={styles.eventLine} numberOfLines={1}>
                              {ev.type}
                            </Text>
                            <Text style={styles.eventLine} numberOfLines={1}>
                              {ev.lecturer || '—'}
                            </Text>
                            <Text style={styles.eventLine} numberOfLines={1}>
                              {ev.location || '—'}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}

                {/* Feature 5: Current Real-World Time Horizontal Timeline Indicator */}
                {showCurrentTimeIndicator && (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.currentTimeLineContainer,
                      { top: currentTimeTopPx },
                    ]}
                  >
                    <View style={styles.currentTimeBadge}>
                      <Text style={styles.currentTimeBadgeText}>
                        {currentTimeFormatted}
                      </Text>
                    </View>
                    <View style={styles.currentTimeDot} />
                    <View style={styles.currentTimeHorizontalBar} />
                  </View>
                )}
              </View>
            </ScrollView>
          </Animated.View>

          {/* MY COURSES SECTION (Bottom in Portrait, Side Panel in Landscape) */}
          <View
            style={[
              styles.myCoursesSection,
              isLandscape && styles.myCoursesSectionLandscape,
            ]}
          >
            <View style={styles.myCoursesHeader}>
              <Text style={styles.myCoursesTitle}>
                My Courses ({activeCourseItems.length}) • Tasks ({tasks.length})
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {activeCourseItems.length > 0 && (
                  <TouchableOpacity onPress={() => handleOpenTaskModal()}>
                    <Text style={styles.addTaskHeaderLink}>+ מטלה (Task)</Text>
                  </TouchableOpacity>
                )}
                {highlightedKey ? (
                  <TouchableOpacity onPress={() => setHighlightedKey(null)}>
                    <Text style={styles.clearHighlightText}>Clear ✕</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.myCoursesHint}>
                    1-tap: highlight • 2-tap: hide
                  </Text>
                )}
              </View>
            </View>

            {activeCourseItems.length === 0 ? (
              <Text style={styles.emptyMyCoursesText}>
                No active courses or custom events yet. Tap any empty calendar slot or "+ Courses" to begin.
              </Text>
            ) : (
              <ScrollView
                horizontal={!isLandscape}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={isLandscape}
                contentContainerStyle={
                  isLandscape
                    ? styles.myCoursesListLandscape
                    : styles.myCoursesList
                }
              >
                {activeCourseItems.map((item) => {
                  const isSelected = highlightedKey === item.relationKey;
                  const courseExams = item.courseId
                    ? trackedExams.filter((ex) => ex.courseId === item.courseId)
                    : [];
                  const courseTasks = tasks.filter(
                    (t) =>
                      t.relationKey === item.relationKey ||
                      (item.courseId && t.courseId === item.courseId)
                  );

                  return (
                    <TouchableOpacity
                      key={item.relationKey}
                      activeOpacity={0.8}
                      onPress={() => handleMyCourseItemPress(item.relationKey)}
                      style={[
                        styles.myCoursePill,
                        isLandscape && styles.myCoursePillLandscape,
                        { borderLeftColor: item.color },
                        isSelected && styles.myCoursePillSelected,
                        item.isHidden && styles.myCoursePillHidden,
                      ]}
                    >
                      <View style={styles.myCoursePillTop}>
                        {item.courseId && (
                          <Text
                            style={[
                              styles.myCourseCode,
                              item.isHidden && styles.textStrikethrough,
                            ]}
                          >
                            {item.courseId}
                          </Text>
                        )}
                        <Text
                          style={[
                            styles.myCourseName,
                            isSelected && { color: '#1D4ED8' },
                            item.isHidden && styles.textStrikethrough,
                          ]}
                          numberOfLines={1}
                        >
                          {item.title}
                        </Text>
                        <TouchableOpacity
                          style={styles.quickAddTaskIconBtn}
                          onPress={() => handleOpenTaskModal(item.relationKey)}
                        >
                          <Text style={styles.quickAddTaskIconText}>+מטלה</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.myCourseSub} numberOfLines={1}>
                        {item.isHidden
                          ? '👁️ Hidden (Double-tap to show)'
                          : `${item.typesSummary.join(' • ')} (${item.sessionCount})`}
                      </Text>
                      {courseExams.length > 0 && (
                        <Text style={styles.myCourseExamsText} numberOfLines={1}>
                          📝{' '}
                          {courseExams
                            .map(
                              (e) =>
                                `${e.moedLabel.split(' ')[0]} ${
                                  e.moedLabel.split(' ')[1] || ''
                                }: ${e.displayDate}`
                            )
                            .join(' | ')}
                        </Text>
                      )}

                      {/* Feature 4: Tasks/Assignments (מטלות) list with dynamic countdown — Touchable to open Task Details Modal */}
                      {courseTasks.length > 0 && (
                        <View style={styles.courseTasksList}>
                          {courseTasks.map((tsk) => {
                            const countdown = formatTaskCountdown(
                              tsk.deadlineISO,
                              nowDate.getTime()
                            );
                            const taskColor = getTaskCourseColor(tsk);
                            return (
                              <TouchableOpacity
                                key={tsk.id}
                                activeOpacity={0.75}
                                onPress={() =>
                                  setSelectedTask({ ...tsk, color: taskColor })
                                }
                                style={[
                                  styles.courseTaskItem,
                                  { borderLeftColor: taskColor },
                                ]}
                              >
                                <View style={{ flex: 1, marginRight: 4 }}>
                                  <Text
                                    style={styles.courseTaskTitle}
                                    numberOfLines={1}
                                  >
                                    📌 {tsk.title}
                                  </Text>
                                  <Text
                                    style={[
                                      styles.courseTaskCountdown,
                                      countdown.isUrgent && {
                                        color: '#DC2626',
                                        fontWeight: '800',
                                      },
                                    ]}
                                    numberOfLines={1}
                                  >
                                    ⏳ {countdown.text}
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  onPress={() => handleDeleteTask(tsk.id)}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                  <Text style={styles.deleteTaskBtnText}>✕</Text>
                                </TouchableOpacity>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>

        {/* MODAL 1: COURSE SEARCH, MERGED IDENTICAL GROUPS, SPECIAL FILTERS & AI RATINGS */}
        <Modal visible={searchModalVisible} animationType="slide">
          <SafeAreaProvider>
            <SafeAreaView
              style={styles.modalContainer}
              edges={['top', 'left', 'right', 'bottom']}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Technion Courses</Text>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: '#F59E0B' }]}
                    onPress={handleSyncCheesefork}
                    disabled={loadingLiveCatalog}
                  >
                    <Text style={styles.btnText}>
                      {loadingLiveCatalog ? 'Syncing...' : 'Sync Cheesefork'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setSearchModalVisible(false)}>
                    <Text style={styles.closeText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TextInput
                style={styles.searchInput}
                placeholder="Search course number or name (e.g. 02340124)..."
                value={searchQuery}
                onChangeText={setSearchQuery}
              />

              {/* Special Groups Search Filter Chips */}
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionLabel}>
                  Special Group Filters (Tap to include/exclude):
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterChipsRow}
                >
                  {SPECIAL_GROUP_FILTERS.map((f) => {
                    const included = Boolean(includedSpecialGroups[f.id]);
                    return (
                      <TouchableOpacity
                        key={f.id}
                        onPress={() => toggleSpecialGroupFilter(f.id)}
                        style={[
                          styles.filterChip,
                          included
                            ? styles.filterChipIncluded
                            : styles.filterChipExcluded,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            included
                              ? styles.filterChipTextIncluded
                              : styles.filterChipTextExcluded,
                          ]}
                        >
                          {included ? '✓ ' : '✕ '}
                          {f.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {loadingLiveCatalog ? (
                <View style={styles.centerLoading}>
                  <ActivityIndicator size="large" color="#3B82F6" />
                  <Text style={styles.loadingSubText}>
                    Fetching & parsing {CHEESEFORK_JS_URL}...
                  </Text>
                </View>
              ) : filteredCatalog.length === 0 ? (
                <View style={styles.centerLoading}>
                  <Text style={styles.loadingSubText}>
                    {catalog.length === 0
                      ? 'No courses loaded yet. Tap "Sync Cheesefork" to fetch live Technion courses.'
                      : 'No courses match your search and group filters.'}
                  </Text>
                </View>
              ) : (
                <ScrollView>
                  {filteredCatalog.slice(0, 100).map((course, cIdx) => {
                    const isExpanded = expandedCourseId === course.courseId;

                    return (
                      <View key={course.courseId} style={styles.courseCard}>
                        <TouchableOpacity
                          style={styles.courseHeaderRow}
                          onPress={() => toggleExpandCourse(course.courseId)}
                        >
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={styles.courseTitle}>
                              {course.courseId} — {course.name}
                            </Text>
                            {course.exams && course.exams.length > 0 && (
                              <Text style={styles.courseExamSubText}>
                                📝{' '}
                                {course.exams
                                  .map((ex) => `${ex.moedLabel}: ${ex.displayDate}`)
                                  .join('  •  ')}
                              </Text>
                            )}
                          </View>
                          <Text style={styles.expandActionText}>
                            {isExpanded
                              ? 'Hide Groups ▲'
                              : `Groups (${course.groups.length}) ▼`}
                          </Text>
                        </TouchableOpacity>

                        {isExpanded &&
                          (course.groups.length === 0 ? (
                            <Text style={styles.groupSessions}>
                              No schedule sessions match the active group filters.
                            </Text>
                          ) : (
                            GROUP_SECTIONS.map((section) => {
                              const sectionGroups = course.groups.filter(
                                (g) => g.type === section.type
                              );
                              if (sectionGroups.length === 0) return null;

                              return (
                                <View
                                  key={section.type}
                                  style={[
                                    styles.groupCategoryContainer,
                                    {
                                      borderLeftColor: section.accentColor,
                                      backgroundColor: section.bgColor,
                                    },
                                  ]}
                                >
                                  <View
                                    style={[
                                      styles.groupCategoryHeader,
                                      { backgroundColor: section.accentColor },
                                    ]}
                                  >
                                    <Text style={styles.groupCategoryTitle}>
                                      {section.label} ({sectionGroups.length})
                                    </Text>
                                  </View>

                                  {sectionGroups.map((grp, gIdx) => {
                                    const isAdded = isCourseGroupAdded(
                                      course.courseId,
                                      grp
                                    );

                                    return (
                                      <View
                                        key={`${grp.type}_${grp.groupId}_${gIdx}`}
                                        style={[
                                          styles.groupRow,
                                          gIdx === 0 && {
                                            borderTopWidth: 0,
                                            marginTop: 0,
                                          },
                                        ]}
                                      >
                                        <View style={{ flex: 1 }}>
                                          {/* Feature 2: Merged identical groups displayed as e.g. "[10], [11], [12]" */}
                                          <Text style={styles.groupTitle}>
                                            Group {grp.groupId} — {grp.lecturer}
                                          </Text>
                                          <Text style={styles.groupSessions}>
                                            {grp.sessions
                                              .map(
                                                (s) =>
                                                  `${DAYS[s.day]} ${formatHour(
                                                    s.startHour
                                                  )}-${formatHour(s.endHour)} (${
                                                    s.location || 'TBA'
                                                  })`
                                              )
                                              .join(', ')}
                                          </Text>
                                        </View>

                                        <TouchableOpacity
                                          style={[
                                            styles.toggleGroupBtn,
                                            isAdded
                                              ? styles.removeGroupBtn
                                              : styles.addGroupBtn,
                                          ]}
                                          onPress={() =>
                                            toggleCourseGroup(
                                              course,
                                              grp,
                                              COLOR_PALETTE[
                                                cIdx % COLOR_PALETTE.length
                                              ]
                                            )
                                          }
                                        >
                                          <Text
                                            style={[
                                              styles.btnText,
                                              isAdded && styles.removeBtnText,
                                            ]}
                                          >
                                            {isAdded ? 'REMOVE' : 'ADD'}
                                          </Text>
                                        </TouchableOpacity>
                                      </View>
                                    );
                                  })}
                                </View>
                              );
                            })
                          ))}
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </SafeAreaView>
          </SafeAreaProvider>
        </Modal>

        {/* MODAL 2: EVENT INSPECTOR (COLOR SYNC + TWO DISTINCT REMOVAL OPTIONS) */}
        <Modal visible={!!selectedEvent} transparent animationType="fade">
          <View style={styles.modalBackdrop}>
            {selectedEvent && (
              <View style={styles.inspectorCard}>
                <Text style={styles.inspectorTitle}>{selectedEvent.title}</Text>
                {selectedEvent.courseId && (
                  <Text style={styles.inspectorMeta}>
                    Course ID: {selectedEvent.courseId}
                  </Text>
                )}
                {selectedEvent.groupId && (
                  <Text style={styles.inspectorMeta}>
                    Group: {selectedEvent.groupId}
                  </Text>
                )}
                <Text style={styles.inspectorMeta}>
                  {selectedEvent.type} • {DAYS[selectedEvent.day]}{' '}
                  {formatHour(selectedEvent.startHour)} -{' '}
                  {formatHour(selectedEvent.endHour)}
                </Text>
                {selectedEvent.lecturer && (
                  <Text style={styles.inspectorMeta}>
                    {selectedEvent.type === 'Exam' ? 'Exam:' : 'Group / Instructor:'}{' '}
                    {selectedEvent.lecturer}
                  </Text>
                )}
                {selectedEvent.location && (
                  <Text style={styles.inspectorMeta}>
                    {selectedEvent.type === 'Exam' ? 'Date:' : 'Location:'}{' '}
                    {selectedEvent.location}
                  </Text>
                )}

                {selectedEvent.type !== 'Exam' && (
                  <>
                    <Text style={styles.sectionLabel}>
                      Block Color (Syncs to all related events):
                    </Text>
                    <View style={styles.colorRow}>
                      {COLOR_PALETTE.map((hex) => (
                        <TouchableOpacity
                          key={hex}
                          onPress={() => updateEventColor(selectedEvent, hex)}
                          style={[
                            styles.colorSwatch,
                            { backgroundColor: hex },
                            selectedEvent.color === hex && styles.colorSwatchSelected,
                          ]}
                        />
                      ))}
                    </View>
                  </>
                )}

                <View style={styles.inspectorActionsColumn}>
                  {selectedEvent.type !== 'Exam' && (
                    <TouchableOpacity
                      style={[styles.inspectorOptionBtn, { backgroundColor: '#EF4444' }]}
                      onPress={() => deleteSingleEventInstance(selectedEvent.id)}
                    >
                      <Text style={styles.btnText}>Remove this specific event</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.inspectorOptionBtn, { backgroundColor: '#991B1B' }]}
                    onPress={() => deleteAllRelatedEvents(selectedEvent)}
                  >
                    <Text style={styles.btnText}>Remove all related events</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.inspectorOptionBtn, { backgroundColor: '#6B7280' }]}
                    onPress={() => setSelectedEvent(null)}
                  >
                    <Text style={styles.btnText}>Cancel / Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </Modal>

        {/* MODAL 3: ADD CUSTOM EVENT (PRE-FILLED BY TAP-TO-CREATE OR MANUAL) */}
        <Modal visible={customModalVisible} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={styles.inspectorCard}>
              <Text style={styles.inspectorTitle}>Add Custom Event</Text>

              <TextInput
                style={styles.searchInput}
                placeholder="Title (e.g., Office Hours, Self Study, Work)"
                value={customTitle}
                onChangeText={setCustomTitle}
              />

              <Text style={styles.sectionLabel}>Group Assignment:</Text>
              <TouchableOpacity
                style={styles.dropdownSelector}
                onPress={() => setGroupDropdownOpen((prev) => !prev)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <View
                    style={[
                      styles.dropdownColorDot,
                      {
                        backgroundColor: selectedAssignedGroup
                          ? selectedAssignedGroup.color
                          : customColor,
                      },
                    ]}
                  />
                  <Text style={styles.dropdownSelectorText} numberOfLines={1}>
                    {selectedAssignedGroup
                      ? `${selectedAssignedGroup.courseId ? `${selectedAssignedGroup.courseId} — ` : ''}${selectedAssignedGroup.title}`
                      : '➕ Create New Group'}
                  </Text>
                </View>
                <Text style={styles.dropdownArrow}>
                  {groupDropdownOpen ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>

              {groupDropdownOpen && (
                <View style={styles.dropdownList}>
                  <TouchableOpacity
                    style={[
                      styles.dropdownOption,
                      customAssignedRelationKey === null &&
                        styles.dropdownOptionSelected,
                    ]}
                    onPress={() => {
                      setCustomAssignedRelationKey(null);
                      setGroupDropdownOpen(false);
                    }}
                  >
                    <Text style={[styles.dropdownOptionText, { fontWeight: '700' }]}>
                      ➕ Create New Group
                    </Text>
                  </TouchableOpacity>

                  {activeCourseItems.map((item) => (
                    <TouchableOpacity
                      key={item.relationKey}
                      style={[
                        styles.dropdownOption,
                        customAssignedRelationKey === item.relationKey &&
                          styles.dropdownOptionSelected,
                      ]}
                      onPress={() => {
                        setCustomAssignedRelationKey(item.relationKey);
                        setCustomColor(item.color);
                        setGroupDropdownOpen(false);
                      }}
                    >
                      <View
                        style={[
                          styles.dropdownColorDot,
                          { backgroundColor: item.color },
                        ]}
                      />
                      <Text style={styles.dropdownOptionText} numberOfLines={1}>
                        {item.courseId ? `${item.courseId} — ` : 'Custom Group: '}
                        {item.title}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.sectionLabel}>Day of Week:</Text>
              <View style={styles.daySelectorRow}>
                {DAYS.map((d, idx) => (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setCustomDay(idx as DayOfWeek)}
                    style={[
                      styles.dayChip,
                      customDay === idx && { backgroundColor: '#3B82F6' },
                    ]}
                  >
                    <Text
                      style={{
                        color: customDay === idx ? '#fff' : '#1F2937',
                        fontWeight: '600',
                      }}
                    >
                      {d}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionLabel}>Start Hour (e.g. 14.5):</Text>
                  <TextInput
                    style={styles.searchInput}
                    keyboardType="numeric"
                    value={customStart}
                    onChangeText={setCustomStart}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionLabel}>End Hour (e.g. 17.5):</Text>
                  <TextInput
                    style={styles.searchInput}
                    keyboardType="numeric"
                    value={customEnd}
                    onChangeText={setCustomEnd}
                  />
                </View>
              </View>

              {!selectedAssignedGroup && (
                <>
                  <Text style={styles.sectionLabel}>New Group Color:</Text>
                  <View style={styles.colorRow}>
                    {COLOR_PALETTE.map((hex) => (
                      <TouchableOpacity
                        key={hex}
                        onPress={() => setCustomColor(hex)}
                        style={[
                          styles.colorSwatch,
                          { backgroundColor: hex },
                          customColor === hex && styles.colorSwatchSelected,
                        ]}
                      />
                    ))}
                  </View>
                </>
              )}

              <View style={styles.inspectorActions}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#10B981' }]}
                  onPress={handleAddCustomEvent}
                >
                  <Text style={styles.btnText}>Add to Schedule</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#6B7280' }]}
                  onPress={() => setCustomModalVisible(false)}
                >
                  <Text style={styles.btnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* MODAL 4: AUTOMATIC SCHEDULE BUILDER (BACKTRACKING SOLVER) */}
        <Modal visible={autoBuilderModalVisible} animationType="slide">
          <SafeAreaProvider>
            <SafeAreaView
              style={styles.modalContainer}
              edges={['top', 'left', 'right', 'bottom']}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>⚡ Auto Schedule Builder</Text>
                <TouchableOpacity onPress={() => setAutoBuilderModalVisible(false)}>
                  <Text style={styles.closeText}>Close</Text>
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* STEP 1: SELECT DESIRED COURSES */}
                <View style={styles.autoSectionCard}>
                  <Text style={styles.autoSectionTitle}>
                    1. Select Desired Courses ({desiredCourseIds.length})
                  </Text>

                  {desiredCourseIds.length > 0 && (
                    <View style={styles.selectedCoursesWrap}>
                      {desiredCourseIds.map((cid) => {
                        const cObj = catalog.find((c) => c.courseId === cid);
                        return (
                          <TouchableOpacity
                            key={cid}
                            style={styles.selectedCourseChip}
                            onPress={() => toggleDesiredCourse(cid)}
                          >
                            <Text style={styles.selectedCourseChipText}>
                              {cid} {cObj ? `• ${cObj.name}` : ''} ✕
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search catalog to add desired courses..."
                    value={autoSearchQuery}
                    onChangeText={setAutoSearchQuery}
                  />

                  {loadingLiveCatalog ? (
                    <ActivityIndicator size="small" color="#3B82F6" />
                  ) : (
                    <View style={styles.autoCourseListBox}>
                      {autoFilteredCatalog.slice(0, 8).map((course) => {
                        const isSelected = desiredCourseIds.includes(course.courseId);
                        return (
                          <TouchableOpacity
                            key={course.courseId}
                            style={styles.autoCourseRow}
                            onPress={() => toggleDesiredCourse(course.courseId)}
                          >
                            <Text
                              style={styles.autoCourseRowText}
                              numberOfLines={1}
                            >
                              {course.courseId} — {course.name}
                            </Text>
                            <View
                              style={[
                                styles.autoSelectBadge,
                                isSelected && styles.autoSelectBadgeActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.autoSelectBadgeText,
                                  isSelected && { color: '#fff' },
                                ]}
                              >
                                {isSelected ? '✓ Selected' : '+ Select'}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>

                {/* STEP 2: MANDATORY LOCKED EVENTS */}
                <View style={styles.autoSectionCard}>
                  <View style={styles.autoSectionHeaderRow}>
                    <Text style={styles.autoSectionTitle}>
                      2. Mandatory Locked Events ({lockedEvents.length})
                    </Text>
                    <TouchableOpacity onPress={handleImportCurrentCustomAsLocked}>
                      <Text style={styles.importLinkText}>
                        + Lock Current Custom Events
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {lockedEvents.length > 0 && (
                    <View style={{ marginBottom: 10, gap: 6 }}>
                      {lockedEvents.map((lockEv) => (
                        <View key={lockEv.id} style={styles.lockedItemRow}>
                          <Text style={styles.lockedItemText}>
                            🔒 {lockEv.title} • {DAYS[lockEv.day]}{' '}
                            {formatHour(lockEv.startHour)}-{formatHour(lockEv.endHour)}
                          </Text>
                          <TouchableOpacity
                            onPress={() => {
                              setLockedEvents((prev) =>
                                prev.filter((e) => e.id !== lockEv.id)
                              );
                              setHasRunAutoBuilder(false);
                            }}
                          >
                            <Text style={styles.removeLockText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <TextInput
                      style={[styles.searchInput, { flex: 1.5, marginBottom: 0 }]}
                      placeholder="Locked event (e.g. Work)"
                      value={lockTitle}
                      onChangeText={setLockTitle}
                    />
                    <TextInput
                      style={[styles.searchInput, { flex: 0.7, marginBottom: 0 }]}
                      placeholder="Start"
                      keyboardType="numeric"
                      value={lockStart}
                      onChangeText={setLockStart}
                    />
                    <TextInput
                      style={[styles.searchInput, { flex: 0.7, marginBottom: 0 }]}
                      placeholder="End"
                      keyboardType="numeric"
                      value={lockEnd}
                      onChangeText={setLockEnd}
                    />
                  </View>

                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {DAYS.map((d, idx) => (
                        <TouchableOpacity
                          key={d}
                          onPress={() => setLockDay(idx as DayOfWeek)}
                          style={[
                            styles.dayChip,
                            lockDay === idx && { backgroundColor: '#3B82F6' },
                          ]}
                        >
                          <Text
                            style={{
                              color: lockDay === idx ? '#fff' : '#1F2937',
                              fontSize: 11,
                              fontWeight: '600',
                            }}
                          >
                            {d}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: '#374151' }]}
                      onPress={handleAddLockedEvent}
                    >
                      <Text style={styles.btnText}>+ Lock Slot</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* STEP 3: GENERATE COMBINATIONS BUTTON */}
                <TouchableOpacity
                  style={styles.generateBtn}
                  onPress={handleRunAutoBuilder}
                >
                  <Text style={styles.generateBtnText}>
                    ⚡ Generate Valid Schedule Combinations
                  </Text>
                </TouchableOpacity>

                {/* STEP 4: RESULTS PREVIEW (UP TO 2 COMBINATIONS) */}
                {hasRunAutoBuilder && (
                  <View style={{ marginTop: 14, marginBottom: 30 }}>
                    <Text style={styles.autoSectionTitle}>
                      Generated Options ({generatedOptions.length} found)
                    </Text>

                    {generatedOptions.length === 0 ? (
                      <Text style={styles.emptyMyCoursesText}>
                        No combinations could be generated.
                      </Text>
                    ) : (
                      generatedOptions.map((opt) => (
                        <View key={opt.optionIndex} style={styles.optionResultCard}>
                          <View style={styles.optionHeaderRow}>
                            <Text style={styles.optionTitle}>
                              Option #{opt.optionIndex}
                            </Text>
                            <Text style={styles.optionFitBadge}>
                              {opt.includedCourses.length} /{' '}
                              {opt.includedCourses.length + opt.omittedCourses.length}{' '}
                              Courses Fit
                            </Text>
                          </View>

                          <Text style={styles.optionSubHeading}>
                            ✅ Included Courses ({opt.includedCourses.length}):
                          </Text>
                          {opt.includedCourses.length === 0 ? (
                            <Text style={styles.optionItemText}>
                              None of the selected courses could fit without conflicts.
                            </Text>
                          ) : (
                            opt.includedCourses.map((inc) => (
                              <View key={inc.courseId} style={styles.includedCourseRow}>
                                <Text style={styles.includedCourseTitle}>
                                  • {inc.courseId} — {inc.courseName}
                                </Text>
                                <Text style={styles.includedCourseGroups}>
                                  {[
                                    inc.lectureGroupId
                                      ? `Lecture ${inc.lectureGroupId}`
                                      : null,
                                    inc.tutorialGroupId
                                      ? `Tutorial ${inc.tutorialGroupId}`
                                      : null,
                                    inc.labGroupId
                                      ? `Lab ${inc.labGroupId}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' | ')}
                                </Text>
                              </View>
                            ))
                          )}

                          <Text
                            style={[
                              styles.optionSubHeading,
                              { marginTop: 8, color: '#B91C1C' },
                            ]}
                          >
                            ⚠️ Omitted Courses ({opt.omittedCourses.length}):
                          </Text>
                          {opt.omittedCourses.length === 0 ? (
                            <Text style={styles.noOmittedText}>
                              None — All desired courses fit without overlaps!
                            </Text>
                          ) : (
                            opt.omittedCourses.map((om) => (
                              <View key={om.courseId} style={styles.omittedCourseRow}>
                                <Text style={styles.omittedCourseTitle}>
                                  ✕ {om.courseId} — {om.courseName}
                                </Text>
                                <Text style={styles.omittedCourseReason}>
                                  {om.reason}
                                </Text>
                              </View>
                            ))
                          )}

                          <TouchableOpacity
                            style={styles.selectOptionBtn}
                            onPress={() => handleSelectGeneratedSchedule(opt)}
                          >
                            <Text style={styles.selectOptionBtnText}>
                              Select this Schedule
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </ScrollView>
            </SafeAreaView>
          </SafeAreaProvider>
        </Modal>

        {/* MODAL 5: "I HAVE FREE TIME" (יש לי זמן פנוי) SPONTANEOUS FINDER */}
        <Modal visible={freeTimeModalVisible} transparent animationType="slide">
          <View style={styles.bottomSheetBackdrop}>
            <View style={styles.bottomSheetCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>
                    🕒 יש לי זמן פנוי (Free Time)
                  </Text>
                  {freeTimeCheckedAt && (
                    <Text style={styles.freeTimeSubHeader}>
                      Tracked courses starting within 2 hours of{' '}
                      {DAYS[freeTimeCheckedAt.getDay()] || 'Today'}{' '}
                      {formatHour(
                        freeTimeCheckedAt.getHours() +
                          freeTimeCheckedAt.getMinutes() / 60
                      )}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => setFreeTimeModalVisible(false)}>
                  <Text style={styles.closeText}>Close</Text>
                </TouchableOpacity>
              </View>

              {trackedCourseIds.length === 0 ? (
                <View style={styles.emptyFreeTimeBox}>
                  <Text style={styles.emptyFreeTimeTitle}>
                    No Tracked Courses Yet
                  </Text>
                  <Text style={styles.emptyFreeTimeSub}>
                    Add courses to your schedule first so we can find spontaneous
                    lectures & tutorials starting soon!
                  </Text>
                </View>
              ) : spontaneousEvents.length === 0 ? (
                <View style={styles.emptyFreeTimeBox}>
                  <Text style={styles.emptyFreeTimeTitle}>
                    No Sessions Starting in the Next 2 Hours
                  </Text>
                  <Text style={styles.emptyFreeTimeSub}>
                    None of your {trackedCourseIds.length} tracked course(s) have a
                    lecture or tutorial starting within the next 2 hours. Enjoy your
                    break!
                  </Text>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 380 }}>
                  {spontaneousEvents.map((item) => (
                    <View
                      key={item.key}
                      style={[
                        styles.spontaneousCard,
                        { borderLeftColor: item.color },
                      ]}
                    >
                      <View style={styles.spontaneousTopRow}>
                        <Text style={styles.spontaneousCourseTitle} numberOfLines={1}>
                          {item.courseId ? `${item.courseId} — ` : ''}
                          {item.courseName}
                        </Text>
                        <View style={styles.startsInBadge}>
                          <Text style={styles.startsInBadgeText}>
                            {item.minutesUntilStart === 0
                              ? 'Starting Now!'
                              : `In ${item.minutesUntilStart} min`}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.spontaneousTypeText}>
                        {item.type} (Group {item.groupId}) • {item.lecturer}
                      </Text>

                      <View style={styles.spontaneousBottomRow}>
                        <Text style={styles.spontaneousTimeText}>
                          🕒 {formatHour(item.startHour)} – {formatHour(item.endHour)}
                        </Text>
                        <Text style={styles.spontaneousRoomText}>
                          📍 Room: {item.location}
                        </Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* MODAL 6: FEATURE 4 — CREATE TASK / ASSIGNMENT (מטלה) LINKED TO COURSE GROUP */}
        <Modal visible={taskModalVisible} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={styles.inspectorCard}>
              <Text style={styles.inspectorTitle}>📌 Add Course Task (מטלה)</Text>

              <TextInput
                style={styles.searchInput}
                placeholder="Task title (e.g., HW 3, Wet Lab Report, Project Milestone)"
                value={taskTitle}
                onChangeText={setTaskTitle}
              />

              <Text style={styles.sectionLabel}>Link to Course Group:</Text>
              <TouchableOpacity
                style={styles.dropdownSelector}
                onPress={() => setTaskDropdownOpen((prev) => !prev)}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    flex: 1,
                  }}
                >
                  <View
                    style={[
                      styles.dropdownColorDot,
                      {
                        backgroundColor: selectedTaskGroup
                          ? selectedTaskGroup.color
                          : '#3B82F6',
                      },
                    ]}
                  />
                  <Text style={styles.dropdownSelectorText} numberOfLines={1}>
                    {selectedTaskGroup
                      ? `${
                          selectedTaskGroup.courseId
                            ? `${selectedTaskGroup.courseId} — `
                            : ''
                        }${selectedTaskGroup.title}`
                      : 'Select a course group'}
                  </Text>
                </View>
                <Text style={styles.dropdownArrow}>
                  {taskDropdownOpen ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>

              {taskDropdownOpen && (
                <View style={styles.dropdownList}>
                  {activeCourseItems.map((item) => (
                    <TouchableOpacity
                      key={item.relationKey}
                      style={[
                        styles.dropdownOption,
                        taskRelationKey === item.relationKey &&
                          styles.dropdownOptionSelected,
                      ]}
                      onPress={() => {
                        setTaskRelationKey(item.relationKey);
                        setTaskDropdownOpen(false);
                      }}
                    >
                      <View
                        style={[
                          styles.dropdownColorDot,
                          { backgroundColor: item.color },
                        ]}
                      />
                      <Text style={styles.dropdownOptionText} numberOfLines={1}>
                        {item.courseId ? `${item.courseId} — ` : ''}
                        {item.title}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.sectionLabel}>
                Quick Distant Deadline Presets:
              </Text>
              <View style={styles.presetChipsRow}>
                {[
                  { label: '+3 Days', days: 3 },
                  { label: '+1 Week', days: 7 },
                  { label: '+2 Weeks', days: 14 },
                  { label: '+1 Month', days: 30 },
                ].map((preset) => (
                  <TouchableOpacity
                    key={preset.label}
                    style={styles.presetChip}
                    onPress={() => applyTaskPresetDays(preset.days)}
                  >
                    <Text style={styles.presetChipText}>{preset.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1.4 }}>
                  <Text style={styles.sectionLabel}>Deadline Date (DD/MM/YYYY):</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="25/12/2026"
                    value={taskDateStr}
                    onChangeText={setTaskDateStr}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionLabel}>Time (HH:MM):</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="23:59"
                    value={taskTimeStr}
                    onChangeText={setTaskTimeStr}
                  />
                </View>
              </View>

              <TextInput
                style={styles.searchInput}
                placeholder="Description / notes (optional)"
                value={taskDescription}
                onChangeText={setTaskDescription}
              />

              <TextInput
                style={styles.searchInput}
                placeholder="Assignment URL / link (optional)"
                value={taskUrl}
                onChangeText={setTaskUrl}
                autoCapitalize="none"
              />

              <View style={styles.inspectorActions}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#EC4899' }]}
                  onPress={handleAddTask}
                >
                  <Text style={styles.btnText}>Save Task (מטלה)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#6B7280' }]}
                  onPress={() => setTaskModalVisible(false)}
                >
                  <Text style={styles.btnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* MODAL 6B: TASK DETAILS MODAL (LARGE FORMAT VIEW OF SELECTED TASK) */}
        <Modal
          visible={!!selectedTask}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedTask(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.taskDetailCard}>
              {selectedTask && (
                <>
                  <View style={styles.taskDetailHeaderRow}>
                    <View
                      style={[
                        styles.taskDetailCourseBadge,
                        { backgroundColor: getTaskCourseColor(selectedTask) },
                      ]}
                    >
                      <Text style={styles.taskDetailCourseBadgeText}>
                        {selectedTask.courseId
                          ? `${selectedTask.courseId} • ${
                              selectedTask.courseTitle ||
                              selectedTask.groupTitle ||
                              'Course'
                            }`
                          : selectedTask.courseTitle ||
                            selectedTask.groupTitle ||
                            'Course'}
                      </Text>
                    </View>
                    {selectedTask.source && (
                      <View style={styles.taskDetailSourceChip}>
                        <Text style={styles.taskDetailSourceText}>
                          {selectedTask.source === 'Moodle'
                            ? '🎓 Moodle'
                            : selectedTask.source === 'Webwork'
                            ? '💻 Webwork'
                            : '📝 Manual'}
                        </Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.taskDetailTitle}>
                    📌 {selectedTask.title}
                  </Text>

                  <View style={styles.taskDetailMetaBox}>
                    <Text style={styles.taskDetailMetaLabel}>
                      📅 Due Date & Time:
                    </Text>
                    <Text style={styles.taskDetailMetaValue}>
                      {(() => {
                        const d = new Date(selectedTask.deadlineISO);
                        if (Number.isNaN(d.getTime())) {
                          return selectedTask.deadlineISO;
                        }
                        const dayLabel = DAYS[d.getDay()] || '';
                        const dd = d.getDate().toString().padStart(2, '0');
                        const mm = (d.getMonth() + 1).toString().padStart(2, '0');
                        const yyyy = d.getFullYear();
                        const hh = d.getHours().toString().padStart(2, '0');
                        const min = d.getMinutes().toString().padStart(2, '0');
                        return `${dayLabel}, ${dd}/${mm}/${yyyy} at ${hh}:${min}`;
                      })()}
                    </Text>
                    <Text
                      style={[
                        styles.taskDetailCountdownText,
                        formatTaskCountdown(
                          selectedTask.deadlineISO,
                          nowDate.getTime()
                        ).isUrgent && { color: '#DC2626' },
                      ]}
                    >
                      ⏳{' '}
                      {
                        formatTaskCountdown(
                          selectedTask.deadlineISO,
                          nowDate.getTime()
                        ).text
                      }
                    </Text>
                  </View>

                  {selectedTask.description ? (
                    <View style={styles.taskDetailDescBox}>
                      <Text style={styles.taskDetailMetaLabel}>
                        📝 Description:
                      </Text>
                      <ScrollView style={{ maxHeight: 140 }}>
                        <Text style={styles.taskDetailDescText}>
                          {selectedTask.description}
                        </Text>
                      </ScrollView>
                    </View>
                  ) : null}

                  {selectedTask.url ? (
                    <TouchableOpacity
                      style={[
                        styles.inspectorOptionBtn,
                        { backgroundColor: '#0284C7', marginTop: 10 },
                      ]}
                      onPress={() => {
                        if (selectedTask.url) {
                          Linking.openURL(selectedTask.url).catch(() =>
                            Alert.alert(
                              'Cannot Open Link',
                              selectedTask.url || ''
                            )
                          );
                        }
                      }}
                    >
                      <Text style={styles.btnText} numberOfLines={1}>
                        🔗 Open Assignment Link
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  <View
                    style={[
                      styles.inspectorActions,
                      { marginTop: 14, gap: 10 },
                    ]}
                  >
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        {
                          backgroundColor: '#EF4444',
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                        },
                      ]}
                      onPress={() => {
                        const idToRemove = selectedTask.id;
                        setSelectedTask(null);
                        handleDeleteTask(idToRemove);
                      }}
                    >
                      <Text style={styles.btnText}>🗑️ Delete Task</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.btn,
                        {
                          backgroundColor: '#374151',
                          paddingVertical: 10,
                          paddingHorizontal: 18,
                        },
                      ]}
                      onPress={() => setSelectedTask(null)}
                    >
                      <Text style={styles.btnText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* MODAL 7: FEATURE 6 — IMPORT SCHEDULE FROM PASTED BACKUP JSON */}
        <Modal
          visible={backupModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setBackupModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.inspectorCard}>
              <Text style={styles.inspectorTitle}>📥 Import Schedule</Text>
              <Text style={styles.inspectorMeta}>
                Paste your exported MeatSpoon backup JSON below and tap "Load
                Backup" to restore your courses, custom events, and tasks.
              </Text>

              <TextInput
                style={[
                  styles.searchInput,
                  {
                    minHeight: 150,
                    maxHeight: 240,
                    textAlignVertical: 'top',
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                    fontSize: 12,
                    marginTop: 8,
                  },
                ]}
                multiline
                placeholder='Paste backup JSON here (e.g. {"version": 1, "events": [...], "tasks": [...]})...'
                value={importJsonText}
                onChangeText={setImportJsonText}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {backupBusy ? (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color="#2563EB" />
                </View>
              ) : (
                <View style={styles.inspectorActionsColumn}>
                  <TouchableOpacity
                    style={[
                      styles.inspectorOptionBtn,
                      { backgroundColor: '#2563EB' },
                    ]}
                    onPress={handleLoadBackupFromText}
                  >
                    <Text style={styles.btnText}>Load Backup</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.inspectorOptionBtn,
                      { backgroundColor: '#6B7280' },
                    ]}
                    onPress={() => {
                      setImportJsonText('');
                      setBackupModalVisible(false);
                    }}
                  >
                    <Text style={styles.btnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* MODAL 8: ABOUT / CREDITS */}
        <Modal
          visible={aboutModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setAboutModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.inspectorCard}>
              <Text style={styles.inspectorTitle}>ℹ️ About MeatSpoon</Text>
              <Text style={styles.aboutBodyText}>
                MeatSpoon is an independent, unofficial schedule management tool created for students.{'\n\n'}
                Course data is sourced from Cheesefork, an independent student initiative.{'\n\n'}
                This app is not affiliated with, endorsed by, or connected to the Technion - Israel Institute of Technology in any official capacity.
              </Text>
              <TouchableOpacity
                style={[
                  styles.inspectorOptionBtn,
                  { backgroundColor: '#2563EB', marginTop: 14 },
                ]}
                onPress={() => setAboutModalVisible(false)}
              >
                <Text style={styles.btnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* MODAL 9: SMART WEBVIEW (NATIVE) / .ICS & TEXT SYNC (WEB) FOR MOODLE */}
        <Modal
          visible={moodleModalVisible}
          animationType="slide"
          onRequestClose={() => setMoodleModalVisible(false)}
        >
          <SafeAreaProvider>
            <SafeAreaView
              style={styles.moodleModalContainer}
              edges={['top', 'left', 'right', 'bottom']}
            >
              <View style={styles.moodleHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.moodleHeaderTitle}>
                    🎓 Technion Moodle Task Sync
                  </Text>
                  <Text style={styles.moodleHeaderSub} numberOfLines={1}>
                    {Platform.OS === 'web'
                      ? 'Web / PWA Sync — Import .ics calendar file or Upcoming Events text'
                      : moodleSyncing
                      ? 'Extracting upcoming assignments from Moodle calendar...'
                      : moodleCurrentUrl}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: '#0284C7' }]}
                    onPress={async () => {
                      if (Platform.OS === 'web') {
                        if (moodleWebPasteText.trim()) {
                          await handleWebMoodleImportContent(moodleWebPasteText);
                        } else {
                          const pasted = await handlePasteFromClipboard(
                            setMoodleWebPasteText
                          );
                          if (pasted.trim()) {
                            await handleWebMoodleImportContent(pasted);
                          }
                        }
                        return;
                      }
                      moodleWebViewRef.current?.injectJavaScript(`
                        window.__meatSpoonManualMoodleSync = true;
                        window.__meatSpoonMoodleSyncRunning = false;
                        ${MOODLE_INJECTED_SYNC_SCRIPT}
                      `);
                    }}
                  >
                    <Text style={styles.btnText}>Sync Now</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setMoodleModalVisible(false)}>
                    <Text style={styles.closeText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {Platform.OS === 'web' ? (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.webSyncScrollContent}
                >
                  {webSyncFeedback && (
                    <View
                      style={[
                        styles.webSyncFeedbackBox,
                        webSyncFeedback.isError
                          ? styles.webSyncFeedbackError
                          : styles.webSyncFeedbackOk,
                      ]}
                    >
                      <Text style={styles.webSyncFeedbackText}>
                        {webSyncFeedback.message}
                      </Text>
                    </View>
                  )}

                  <View style={styles.webSyncCard}>
                    <Text style={styles.webSyncCardTitle}>
                      Step 1: Export or Copy from Technion Moodle
                    </Text>
                    <Text style={styles.webSyncCardDesc}>
                      Browsers block embedded login frames on Moodle, so open Moodle in a new tab using your browser session:
                      {'\n'}• Fastest: Open Calendar Export ➔ Select "All events" + "Recent & next 60 days" ➔ click "Export" to download icalexport.ics.
                      {'\n'}• Or open Upcoming Events ➔ press Ctrl+A then Ctrl+C to copy your tasks.
                    </Text>
                    <View style={styles.webSyncBtnRow}>
                      <TouchableOpacity
                        style={[styles.webSyncActionBtn, { backgroundColor: '#0284C7' }]}
                        onPress={() => openExternalBrowserUrl(MOODLE_CALENDAR_EXPORT_PAGE_URL)}
                      >
                        <Text style={styles.webSyncActionBtnText}>
                          🌐 Open Moodle Export (.ics)
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.webSyncActionBtn, { backgroundColor: '#2563EB' }]}
                        onPress={() => openExternalBrowserUrl(MOODLE_UPCOMING_EVENTS_URL)}
                      >
                        <Text style={styles.webSyncActionBtnText}>
                          📅 Open Upcoming Events
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.webSyncCard}>
                    <Text style={styles.webSyncCardTitle}>
                      Step 2A: Upload Downloaded icalexport.ics File
                    </Text>
                    <Text style={styles.webSyncCardDesc}>
                      Imports all deadlines, descriptions, links, and course numbers directly in your browser.
                    </Text>
                    <TouchableOpacity
                      style={[styles.webSyncPrimaryBtn, { backgroundColor: '#059669' }]}
                      onPress={handlePickMoodleIcsFileOnWeb}
                    >
                      <Text style={styles.webSyncPrimaryBtnText}>
                        📁 Choose icalexport.ics File
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.webSyncCard}>
                    <View style={styles.webSyncRowBetween}>
                      <Text style={styles.webSyncCardTitle}>
                        Step 2B: Or Paste .ics / Upcoming Events Text
                      </Text>
                      <TouchableOpacity
                        style={styles.webSyncSmallBtn}
                        onPress={() => handlePasteFromClipboard(setMoodleWebPasteText)}
                      >
                        <Text style={styles.webSyncSmallBtnText}>📋 Paste Clipboard</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.webSyncTextInput}
                      multiline
                      placeholder="Paste raw icalexport.ics content or copied text from Moodle Upcoming Events (Ctrl+V)..."
                      placeholderTextColor="#6B7280"
                      value={moodleWebPasteText}
                      onChangeText={setMoodleWebPasteText}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={[
                        styles.webSyncPrimaryBtn,
                        {
                          backgroundColor: moodleWebPasteText.trim()
                            ? '#0284C7'
                            : '#374151',
                        },
                      ]}
                      onPress={() => handleWebMoodleImportContent(moodleWebPasteText)}
                    >
                      <Text style={styles.webSyncPrimaryBtnText}>
                        🔄 Extract & Sync Pasted Moodle Tasks
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                <>
                  {moodleSyncing && (
                    <View style={styles.moodleSyncBanner}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.moodleSyncBannerText}>
                        Logged in! Fetching Moodle calendar tasks...
                      </Text>
                    </View>
                  )}

                  <WebView<{}>
                    ref={moodleWebViewRef}
                    source={{ uri: MOODLE_LOGIN_URL }}
                    style={{ flex: 1 }}
                    javaScriptEnabled
                    domStorageEnabled
                    sharedCookiesEnabled
                    thirdPartyCookiesEnabled
                    cacheEnabled
                    incognito={false}
                    saveFormDataDisabled={false}
                    keyboardDisplayRequiresUserAction={false}
                    injectedJavaScript={MOODLE_INJECTED_SYNC_SCRIPT}
                    onNavigationStateChange={handleMoodleNavigationStateChange}
                    onMessage={handleMoodleWebViewMessage}
                  />
                </>
              )}
            </SafeAreaView>
          </SafeAreaProvider>
        </Modal>

        {/* MODAL 10: SMART WEBVIEW (NATIVE) / CLIPBOARD & TEXT SYNC (WEB) FOR WEBWORK */}
        <Modal
          visible={webworkModalVisible}
          animationType="slide"
          onRequestClose={() => setWebworkModalVisible(false)}
        >
          <SafeAreaProvider>
            <SafeAreaView
              style={styles.moodleModalContainer}
              edges={['top', 'left', 'right', 'bottom']}
            >
              <View style={styles.moodleHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.moodleHeaderTitle}>
                    💻 Technion Webwork Task Sync
                  </Text>
                  <Text style={styles.moodleHeaderSub} numberOfLines={1}>
                    {Platform.OS === 'web'
                      ? 'Web / PWA Sync — Copy & paste open assignments from Webwork'
                      : webworkSyncing
                      ? 'Scanning open Webwork homework sets & due dates...'
                      : webworkCurrentUrl}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: '#7C3AED' }]}
                    onPress={async () => {
                      if (Platform.OS === 'web') {
                        if (webworkWebPasteText.trim()) {
                          await handleWebWebworkImportContent(webworkWebPasteText);
                        } else {
                          const pasted = await handlePasteFromClipboard(
                            setWebworkWebPasteText
                          );
                          if (pasted.trim()) {
                            await handleWebWebworkImportContent(pasted);
                          }
                        }
                        return;
                      }
                      setWebworkSyncing(true);
                      webworkWebViewRef.current?.injectJavaScript(`
                        window.__meatSpoonForceWebworkScan = true;
                        window.__meatSpoonWebworkSyncRunning = false;
                        ${WEBWORK_INJECTED_SYNC_SCRIPT}
                      `);
                    }}
                  >
                    <Text style={styles.btnText}>Sync Now</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setWebworkModalVisible(false)}>
                    <Text style={styles.closeText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {Platform.OS === 'web' ? (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.webSyncScrollContent}
                >
                  {webSyncFeedback && (
                    <View
                      style={[
                        styles.webSyncFeedbackBox,
                        webSyncFeedback.isError
                          ? styles.webSyncFeedbackError
                          : styles.webSyncFeedbackOk,
                      ]}
                    >
                      <Text style={styles.webSyncFeedbackText}>
                        {webSyncFeedback.message}
                      </Text>
                    </View>
                  )}

                  <View style={styles.webSyncCard}>
                    <Text style={styles.webSyncCardTitle}>
                      Step 1: Open Your Course's WebWork Page
                    </Text>
                    <Text style={styles.webSyncCardDesc}>
                      Open Moodle, go into your Math/WebWork course, click its WebWork link, then press Ctrl+A and Ctrl+C on the WebWork assignments page.
                    </Text>
                    <TouchableOpacity
                      style={[styles.webSyncPrimaryBtn, { backgroundColor: '#7C3AED' }]}
                      onPress={() => openExternalBrowserUrl(WEBWORK_LOGIN_URL)}
                    >
                      <Text style={styles.webSyncPrimaryBtnText}>
                        🌐 Open Moodle Dashboard (➔ Course ➔ WebWork)
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.webSyncCard}>
                    <Text style={styles.webSyncCardTitle}>
                      Step 2: Link Imported Tasks to a Course (Optional)
                    </Text>
                    <TouchableOpacity
                      style={styles.webSyncCoursePicker}
                      onPress={() => setWebworkWebDropdownOpen((prev) => !prev)}
                    >
                      <Text style={styles.webSyncCoursePickerText} numberOfLines={1}>
                        {(() => {
                          if (!webworkWebCourseKey) {
                            return '✨ Auto-detect course from pasted text';
                          }
                          const found = activeCourseItems.find(
                            (c) => c.relationKey === webworkWebCourseKey
                          );
                          return found
                            ? `${found.courseId ? `${found.courseId} — ` : ''}${found.title}`
                            : '✨ Auto-detect course from pasted text';
                        })()}
                      </Text>
                      <Text style={styles.webSyncCoursePickerArrow}>
                        {webworkWebDropdownOpen ? '▲' : '▼'}
                      </Text>
                    </TouchableOpacity>

                    {webworkWebDropdownOpen && (
                      <View style={styles.webSyncDropdownList}>
                        <TouchableOpacity
                          style={styles.webSyncDropdownItem}
                          onPress={() => {
                            setWebworkWebCourseKey(null);
                            setWebworkWebDropdownOpen(false);
                          }}
                        >
                          <Text style={styles.webSyncDropdownItemText}>
                            ✨ Auto-detect course from pasted text
                          </Text>
                        </TouchableOpacity>
                        {activeCourseItems.map((item) => (
                          <TouchableOpacity
                            key={item.relationKey}
                            style={styles.webSyncDropdownItem}
                            onPress={() => {
                              setWebworkWebCourseKey(item.relationKey);
                              setWebworkWebDropdownOpen(false);
                            }}
                          >
                            <View
                              style={[
                                styles.dropdownColorDot,
                                { backgroundColor: item.color },
                              ]}
                            />
                            <Text
                              style={styles.webSyncDropdownItemText}
                              numberOfLines={1}
                            >
                              {item.courseId ? `${item.courseId} — ` : ''}
                              {item.title}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    <View style={[styles.webSyncRowBetween, { marginTop: 12 }]}>
                      <Text style={styles.webSyncCardTitle}>
                        Step 3: Paste Copied WebWork Page Text
                      </Text>
                      <TouchableOpacity
                        style={styles.webSyncSmallBtn}
                        onPress={() => handlePasteFromClipboard(setWebworkWebPasteText)}
                      >
                        <Text style={styles.webSyncSmallBtnText}>📋 Paste Clipboard</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.webSyncTextInput}
                      multiline
                      placeholder={'Paste copied WebWork page here, e.g.:\nOpen Assignments\nHW02-Complex\n.Open. Due 19.11.2026 @ 23:59'}
                      placeholderTextColor="#6B7280"
                      value={webworkWebPasteText}
                      onChangeText={setWebworkWebPasteText}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={[
                        styles.webSyncPrimaryBtn,
                        {
                          backgroundColor: webworkWebPasteText.trim()
                            ? '#7C3AED'
                            : '#374151',
                        },
                      ]}
                      onPress={() =>
                        handleWebWebworkImportContent(webworkWebPasteText)
                      }
                    >
                      <Text style={styles.webSyncPrimaryBtnText}>
                        ✅ Extract & Sync Open WebWork Assignments
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                <>
                  {webworkSyncing ? (
                    <View
                      style={[
                        styles.moodleSyncBanner,
                        { backgroundColor: '#7C3AED' },
                      ]}
                    >
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.moodleSyncBannerText}>
                        Extracting open Webwork assignments...
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.moodleSyncBanner,
                        { backgroundColor: '#374151' },
                      ]}
                    >
                      <Text style={styles.moodleSyncBannerText}>
                        Open your course in Moodle and tap its Webwork link to auto-sync
                      </Text>
                    </View>
                  )}

                  <WebView<{}>
                    ref={webworkWebViewRef}
                    source={{ uri: WEBWORK_LOGIN_URL }}
                    style={{ flex: 1 }}
                    javaScriptEnabled
                    domStorageEnabled
                    sharedCookiesEnabled
                    thirdPartyCookiesEnabled
                    cacheEnabled
                    incognito={false}
                    saveFormDataDisabled={false}
                    keyboardDisplayRequiresUserAction={false}
                    setSupportMultipleWindows={false}
                    onNavigationStateChange={handleWebworkNavigationStateChange}
                    onMessage={handleWebworkWebViewMessage}
                  />
                </>
              )}
            </SafeAreaView>
          </SafeAreaProvider>
        </Modal>

        {/* FLOATING NON-BLOCKING TOAST BANNER FOR SILENT BACKGROUND SYNC */}
        {toastBanner && (
          <View
            style={[
              styles.floatingToastBanner,
              toastBanner.variant === 'warning'
                ? styles.floatingToastWarning
                : styles.floatingToastSuccess,
            ]}
          >
            <Text style={styles.floatingToastText}>{toastBanner.message}</Text>
            {toastBanner.variant === 'warning' && (
              <TouchableOpacity
                style={styles.floatingToastActionBtn}
                onPress={() => {
                  setToastBanner(null);
                  setSettingsModalVisible(true);
                }}
              >
                <Text style={styles.floatingToastActionText}>⚙️ הגדרות</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* HIDDEN 0x0 BACKGROUND WEBVIEW FOR SILENT MOODLE SYNC ON APP MOUNT (NATIVE ONLY) */}
        {Platform.OS !== 'web' && bgMoodleSyncActive && !moodleModalVisible && (
          <View style={styles.hiddenBgWebViewContainer} pointerEvents="none">
            <WebView<{}>
              ref={bgMoodleWebViewRef}
              source={{ uri: MOODLE_CALENDAR_EXPORT_URL }}
              style={{ width: 0, height: 0, opacity: 0 }}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              injectedJavaScript={MOODLE_BG_INJECTED_SYNC_SCRIPT}
              onNavigationStateChange={handleBgMoodleNavigationStateChange}
              onMessage={handleBgMoodleMessage}
              onError={triggerBgMoodleExpiredNotice}
              onHttpError={(evt) => {
                const status = evt?.nativeEvent?.statusCode;
                const url = evt?.nativeEvent?.url || '';
                if (
                  status === 401 ||
                  status === 403 ||
                  url.includes('export_execute')
                ) {
                  triggerBgMoodleExpiredNotice();
                }
              }}
            />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function formatHour(dec: number): string {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  contentContainer: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: '#F9FAFB',
  },
  contentContainerLandscape: {
    flexDirection: 'row',
  },
  calendarMainArea: {
    flex: 1,
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#111827',
    gap: 8,
  },
  zoomResetBadge: {
    backgroundColor: '#374151',
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 6,
  },
  zoomResetText: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '600',
  },
  spoonMenuBtn: {
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spoonMenuEmoji: {
    fontSize: 20,
  },
  spoonMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'flex-end',
    paddingTop: 52,
    paddingRight: 12,
  },
  spoonDropdownMenu: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    minWidth: 210,
    paddingVertical: 4,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  spoonMenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  spoonMenuItemText: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '700',
  },
  settingsModalCard: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
    padding: 18,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  settingsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
    paddingBottom: 12,
    marginBottom: 8,
  },
  settingsHeaderTitle: {
    color: '#F9FAFB',
    fontSize: 20,
    fontWeight: '800',
  },
  settingsHeaderSubtitle: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },
  settingsHeaderCloseIcon: {
    color: '#9CA3AF',
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  settingsSectionLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 6,
  },
  settingsGroupBox: {
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    overflow: 'hidden',
  },
  settingsOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  settingsOptionRowLast: {
    borderBottomWidth: 0,
  },
  settingsOptionText: {
    color: '#F9FAFB',
    fontSize: 15,
    fontWeight: '700',
  },
  settingsToggleLabelText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 18,
    marginRight: 10,
  },
  settingsOptionChevron: {
    color: '#6B7280',
    fontSize: 18,
    fontWeight: '700',
  },
  settingsQuickToolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  settingsQuickToolBtn: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  settingsQuickToolText: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '700',
  },
  settingsCloseBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  settingsCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  hiddenBgWebViewContainer: {
    position: 'absolute',
    width: 0,
    height: 0,
    left: -9999,
    top: -9999,
    opacity: 0,
    overflow: 'hidden',
  },
  floatingToastBanner: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    zIndex: 999,
  },
  floatingToastSuccess: {
    backgroundColor: '#065F46',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  floatingToastWarning: {
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  floatingToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },
  floatingToastActionBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginLeft: 10,
  },
  floatingToastActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  btn: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  dateNavigationBar: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: '#374151',
  },
  dateNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekNavBtn: {
    backgroundColor: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  weekNavBtnText: {
    color: '#F9FAFB',
    fontSize: 11,
    fontWeight: '700',
  },
  weekRangeCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weekRangeTitle: {
    color: '#F9FAFB',
    fontSize: 12.5,
    fontWeight: '700',
  },
  todayChip: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  todayChipText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  examChipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 6,
    paddingBottom: 2,
  },
  examJumpChip: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  examJumpChipActive: {
    backgroundColor: '#DC2626',
    borderColor: '#991B1B',
  },
  examJumpChipText: {
    color: '#991B1B',
    fontSize: 11,
    fontWeight: '700',
  },
  dayHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#E5E7EB',
    borderBottomWidth: 1,
    borderColor: '#D1D5DB',
  },
  timeGutterHeader: { width: 46 },
  dayHeaderCell: {
    flex: 1,
    paddingVertical: 5,
    alignItems: 'center',
  },
  dayHeaderCellToday: {
    backgroundColor: '#DBEAFE',
  },
  dayHeaderText: { fontWeight: '700', fontSize: 12, color: '#374151' },
  dayDateSubText: { fontSize: 10, color: '#6B7280', marginTop: 1 },
  dayHeaderTextToday: { color: '#1D4ED8', fontWeight: '800' },
  pinnedDayTasksContainer: {
    width: '94%',
    marginTop: 3,
    gap: 2,
  },
  pinnedDayTaskChip: {
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  pinnedDayTaskChipText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '700',
  },
  gridScroll: { flex: 1 },
  gridContainer: { flexDirection: 'row', position: 'relative' },
  timeGutter: { width: 46, backgroundColor: '#F3F4F6' },
  timeCell: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 2,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  timeText: { fontSize: 10, color: '#6B7280' },
  dayColumn: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: 1,
    borderColor: '#E5E7EB',
  },
  gridCell: { borderBottomWidth: 1, borderColor: '#F3F4F6' },
  currentTimeLineContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 6,
  },
  currentTimeBadge: {
    width: 44,
    backgroundColor: 'rgba(150, 150, 150, 0.5)',
    paddingVertical: 1.5,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentTimeBadgeText: {
    color: '#374151',
    fontSize: 9,
    fontWeight: '800',
  },
  currentTimeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(150, 150, 150, 0.5)',
    marginLeft: -2,
  },
  currentTimeHorizontalBar: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(150, 150, 150, 0.5)',
  },
  eventBlock: {
    position: 'absolute',
    borderRadius: 5,
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
    zIndex: 5,
  },
  examEventBlock: {
    borderWidth: 2,
    borderColor: '#FDE047',
    zIndex: 8,
  },
  taskEventBlock: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#FFFFFF',
    zIndex: 7,
  },
  eventBlockHighlighted: {
    borderWidth: 2.5,
    borderColor: '#111827',
    zIndex: 10,
    elevation: 6,
  },
  eventTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 9.5,
    lineHeight: 12,
  },
  eventLine: {
    color: '#F3F4F6',
    fontSize: 8.5,
    lineHeight: 11,
  },
  myCoursesSection: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderColor: '#D1D5DB',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  myCoursesSectionLandscape: {
    width: 250,
    borderTopWidth: 0,
    borderLeftWidth: 1,
    borderColor: '#D1D5DB',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  myCoursesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  myCoursesTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  addTaskHeaderLink: {
    fontSize: 11,
    fontWeight: '700',
    color: '#EC4899',
  },
  myCoursesHint: {
    fontSize: 10,
    color: '#6B7280',
  },
  clearHighlightText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  emptyMyCoursesText: {
    fontSize: 12,
    color: '#6B7280',
    paddingVertical: 4,
  },
  myCoursesList: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 2,
  },
  myCoursesListLandscape: {
    flexDirection: 'column',
    gap: 8,
    paddingBottom: 12,
  },
  myCoursePill: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 185,
    maxWidth: 260,
  },
  myCoursePillLandscape: {
    minWidth: 0,
    maxWidth: '100%',
    width: '100%',
  },
  myCoursePillSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
    borderWidth: 1.5,
    borderLeftWidth: 5,
  },
  myCoursePillHidden: {
    backgroundColor: '#F3F4F6',
    opacity: 0.55,
  },
  textStrikethrough: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },
  myCoursePillTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  myCourseCode: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4B5563',
  },
  myCourseName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  quickAddTaskIconBtn: {
    backgroundColor: '#FCE7F3',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  quickAddTaskIconText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#BE185D',
  },
  myCourseSub: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  myCourseExamsText: {
    fontSize: 10,
    color: '#B91C1C',
    fontWeight: '600',
    marginTop: 2,
  },
  courseTasksList: {
    marginTop: 5,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 4,
  },
  courseTaskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F3F4F6',
    borderLeftWidth: 3.5,
    borderLeftColor: '#3B82F6',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  courseTaskTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#111827',
  },
  courseTaskCountdown: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#4B5563',
  },
  deleteTaskBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
    paddingHorizontal: 3,
  },
  taskDetailCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    elevation: 8,
  },
  taskDetailHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  taskDetailCourseBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    maxWidth: '75%',
  },
  taskDetailCourseBadgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  taskDetailSourceChip: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  taskDetailSourceText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
  taskDetailTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  taskDetailMetaBox: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  taskDetailMetaLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#6B7280',
    marginBottom: 4,
  },
  taskDetailMetaValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  taskDetailCountdownText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
  taskDetailDescBox: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  taskDetailDescText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#374151',
  },
  presetChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  presetChip: {
    backgroundColor: '#FCE7F3',
    borderWidth: 1,
    borderColor: '#F472B6',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9D174D',
  },
  modalContainer: { flex: 1, padding: 16, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  closeText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' },
  searchInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  filterSection: {
    marginBottom: 12,
  },
  filterSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  filterChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipIncluded: {
    backgroundColor: '#DBEAFE',
    borderColor: '#2563EB',
  },
  filterChipExcluded: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  filterChipTextIncluded: {
    color: '#1E40AF',
  },
  filterChipTextExcluded: {
    color: '#6B7280',
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingSubText: {
    marginTop: 10,
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center',
  },
  courseCard: {
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  courseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  courseTitle: { fontSize: 15, fontWeight: 'bold' },
  courseExamSubText: {
    fontSize: 11,
    color: '#B91C1C',
    fontWeight: '600',
    marginTop: 3,
  },
  expandActionText: { color: '#2563EB', fontSize: 12, fontWeight: '600' },
  groupCategoryContainer: {
    marginTop: 10,
    borderRadius: 8,
    borderLeftWidth: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  groupCategoryHeader: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  groupCategoryTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  groupTitle: { fontWeight: '600', fontSize: 13, color: '#111827' },
  groupSessions: { fontSize: 12, color: '#4B5563', marginVertical: 2 },
  toggleGroupBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 8,
    minWidth: 74,
    alignItems: 'center',
  },
  addGroupBtn: {
    backgroundColor: '#2563EB',
  },
  removeGroupBtn: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1.5,
    borderColor: '#EF4444',
  },
  removeBtnText: {
    color: '#DC2626',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  bottomSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomSheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    maxHeight: '80%',
  },
  freeTimeSubHeader: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  emptyFreeTimeBox: {
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyFreeTimeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  emptyFreeTimeSub: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  spontaneousCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 5,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  spontaneousTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  spontaneousCourseTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginRight: 8,
  },
  startsInBadge: {
    backgroundColor: '#EDE9FE',
    borderWidth: 1,
    borderColor: '#7C3AED',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  startsInBadgeText: {
    color: '#5B21B6',
    fontSize: 11,
    fontWeight: '800',
  },
  spontaneousTypeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  spontaneousBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  spontaneousTimeText: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '600',
  },
  spontaneousRoomText: {
    fontSize: 12,
    color: '#1D4ED8',
    fontWeight: '700',
  },
  inspectorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  inspectorTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  inspectorMeta: { fontSize: 13, color: '#4B5563', marginBottom: 2 },
  aboutBodyText: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#374151',
    marginTop: 6,
  },
  moodleModalContainer: {
    flex: 1,
    backgroundColor: '#111827',
  },
  moodleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  moodleHeaderTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '700',
  },
  moodleHeaderSub: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2,
  },
  moodleSyncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0284C7',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  moodleSyncBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  webSyncScrollContent: {
    padding: 16,
    gap: 14,
  },
  webSyncCard: {
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 14,
    padding: 16,
  },
  webSyncCardTitle: {
    color: '#F9FAFB',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  webSyncCardDesc: {
    color: '#D1D5DB',
    fontSize: 12.5,
    lineHeight: 19,
    marginBottom: 12,
  },
  webSyncBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  webSyncActionBtn: {
    flex: 1,
    minWidth: 180,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  webSyncActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  webSyncPrimaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  webSyncPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  webSyncRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  webSyncSmallBtn: {
    backgroundColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  webSyncSmallBtnText: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '700',
  },
  webSyncTextInput: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    color: '#F9FAFB',
    fontSize: 12.5,
    minHeight: 130,
    maxHeight: 220,
    padding: 12,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  webSyncCoursePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  webSyncCoursePickerText: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  webSyncCoursePickerArrow: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  webSyncDropdownList: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    maxHeight: 160,
    overflow: 'hidden',
    marginBottom: 4,
  },
  webSyncDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  webSyncDropdownItemText: {
    color: '#E5E7EB',
    fontSize: 13,
    flex: 1,
  },
  webSyncFeedbackBox: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  webSyncFeedbackError: {
    backgroundColor: '#7F1D1D',
    borderColor: '#EF4444',
  },
  webSyncFeedbackOk: {
    backgroundColor: '#065F46',
    borderColor: '#10B981',
  },
  webSyncFeedbackText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginTop: 10, marginBottom: 6 },
  colorRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  colorSwatch: { width: 30, height: 30, borderRadius: 15 },
  colorSwatchSelected: { borderWidth: 3, borderColor: '#111827' },
  inspectorActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  inspectorActionsColumn: {
    flexDirection: 'column',
    gap: 8,
    marginTop: 10,
  },
  inspectorOptionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  dropdownSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    marginBottom: 6,
  },
  dropdownSelectorText: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#6B7280',
  },
  dropdownList: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    maxHeight: 150,
    marginBottom: 8,
    overflow: 'hidden',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownOptionSelected: {
    backgroundColor: '#EFF6FF',
  },
  dropdownOptionText: {
    fontSize: 13,
    color: '#1F2937',
  },
  dropdownColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  daySelectorRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  dayChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
  },
  autoSectionCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  autoSectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  autoSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  importLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  selectedCoursesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  selectedCourseChip: {
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  selectedCourseChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E40AF',
  },
  autoCourseListBox: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  autoCourseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  autoCourseRowText: {
    flex: 1,
    fontSize: 13,
    color: '#1F2937',
    marginRight: 8,
  },
  autoSelectBadge: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  autoSelectBadgeActive: {
    backgroundColor: '#2563EB',
  },
  autoSelectBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
  lockedItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  lockedItemText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2937',
  },
  removeLockText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },
  generateBtn: {
    backgroundColor: '#F59E0B',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  optionResultCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  optionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  optionFitBadge: {
    backgroundColor: '#DBEAFE',
    color: '#1E40AF',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  optionSubHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#047857',
    marginBottom: 4,
  },
  optionItemText: {
    fontSize: 12,
    color: '#4B5563',
  },
  includedCourseRow: {
    paddingVertical: 3,
  },
  includedCourseTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  includedCourseGroups: {
    fontSize: 12,
    color: '#2563EB',
    marginLeft: 12,
  },
  noOmittedText: {
    fontSize: 12,
    color: '#059669',
    fontStyle: 'italic',
  },
  omittedCourseRow: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 4,
    marginTop: 4,
  },
  omittedCourseTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991B1B',
  },
  omittedCourseReason: {
    fontSize: 11,
    color: '#B91C1C',
  },
  selectOptionBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  selectOptionBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
