// src/types/schedule.ts
import type { PaletteMode } from '../utils/colorPalette';

export type DayOfWeek = 0 | 1 | 2 | 3 | 4; // 0 = Sunday, 4 = Thursday

export interface CourseExam {
  id: string;
  courseId: string;
  courseName: string;
  moedLabel: string;       // e.g., "Moed A (מועד א')" or "Moed B (מועד ב')"
  dateISO: string;         // "YYYY-MM-DD"
  displayDate: string;     // "DD/MM/YYYY"
  startHour: number;       // Default 9.0 (09:00) if time not specified
  endHour: number;         // Default 12.0 (12:00) if time not specified
  rawText: string;
}

export interface CourseTask {
  id: string;
  relationKey: string;       // Links task to a course/group in "My Courses" (e.g. "course:02340124")
  courseId?: string;
  courseTitle?: string;
  groupTitle?: string;
  title: string;             // e.g., "HW 3 - Dry & Wet"
  deadlineISO: string;       // ISO timestamp for deadline
  deadlineDisplay?: string;  // e.g., "20/11/2026 23:59"
  deadlineTimestamp?: number; // Epoch ms for dynamic countdown
  description?: string;      // Optional assignment description or status
  url?: string;              // Optional direct link to Moodle/Webwork assignment
  source?: 'Manual' | 'Moodle' | 'Webwork';
  color?: string;            // Optional resolved course color
  createdAtISO?: string;
}

export interface ScheduleEvent {
  id: string;              // Unique instance ID (allows granular deletion)
  courseId?: string;       // e.g., "02340124" (undefined for custom events)
  title: string;           // e.g., "Intro to CS" or "Work"
  type: 'Lecture' | 'Tutorial' | 'Lab' | 'Custom' | 'Exam' | 'Task';
  groupId?: string;        // e.g., "[10], [11]" or "11"
  lecturer?: string;       // e.g., "Prof. Dan Geiger"
  location?: string;       // e.g., "Taub 1"
  day: DayOfWeek;          // 0 (Sun) - 4 (Thu)
  startHour: number;       // Decimal hour: e.g., 8.5 for 08:30, 10:30
  endHour: number;         // Decimal hour: e.g., 10.5 for 10:30
  color: string;           // Hex background color
  examDateISO?: string;    // Present for date-specific Exam blocks ("YYYY-MM-DD")
  taskId?: string;         // Present when block represents a CourseTask on the calendar
}

export interface PositionedEvent extends ScheduleEvent {
  colIndex: number;        // 0-based column index inside an overlap cluster
  totalCols: number;       // Total concurrent columns in this overlap cluster
}

export interface CourseGroupItem {
  groupId: string;         // Formatted as "[10], [11]" when identical groups are merged
  rawGroupIds?: string[];  // Individual group IDs (e.g. ["10", "11"]) before merging
  type: 'Lecture' | 'Tutorial' | 'Lab';
  lecturer: string;
  sessions: {
    day: DayOfWeek;
    startHour: number;
    endHour: number;
    location: string;
  }[];
}

export interface CourseCatalogItem {
  courseId: string;
  name: string;
  groups: CourseGroupItem[];
  exams: CourseExam[];
}

export const ASYNC_STORAGE_KEY = '@meatspoon_persisted_state_v1';

export interface LocalBackupPayload {
  version: number;
  exportedAt: string;
  updatedAt?: string;
  events: ScheduleEvent[];
  tasks: CourseTask[];
  desiredCourseIds: string[];
  lockedEvents: ScheduleEvent[];
  hiddenKeys: Record<string, boolean>;
  includedSpecialGroups: Record<string, boolean>;
  autoOpenMoodleLogin?: boolean;
  moodleIcalUrl?: string;
  floatingFreeTime?: boolean;
  myCoursesPinned?: boolean;
  customPaletteEnabled?: boolean;
  customPaletteBaseHex?: string;
  customPaletteMode?: PaletteMode;
  customPalette?: string[];
}
