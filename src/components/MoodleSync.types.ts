import { CourseCatalogItem, CourseTask, ScheduleEvent } from '../types/schedule';

export interface MoodleSyncProps {
  /**
   * 'settings': renders platform-specific Moodle controls inside the Settings modal.
   * 'runtime': renders native WebView modal + silent 0x0 background sync on mount (null on Web).
   */
  mode: 'settings' | 'runtime';
  events: ScheduleEvent[];
  catalog: CourseCatalogItem[];
  tasks: CourseTask[];
  dismissedTaskIds: string[];
  desiredCourseIds: string[];
  lockedEvents: ScheduleEvent[];
  hiddenKeys: Record<string, boolean>;
  includedSpecialGroups: Record<string, boolean>;
  autoOpenMoodleLogin: boolean;
  moodleIcalUrl: string;
  onChangeMoodleIcalUrl: (url: string) => void;
  isHydratingStorage: boolean;
  modalVisible: boolean;
  onChangeModalVisible: (visible: boolean) => void;
  onCloseSettings: () => void;
  onTasksSynced: (
    incomingTasks: CourseTask[],
    updatedDismissedIds?: string[]
  ) => void;
  onShowToast: (message: string, variant: 'success' | 'warning') => void;
}
