// src/utils/autoScheduleBuilder.ts
import {
  CourseCatalogItem,
  ScheduleEvent,
} from '../types/schedule';

export interface IncludedCourseSelection {
  courseId: string;
  courseName: string;
  lectureGroupId?: string;
  tutorialGroupId?: string;
  labGroupId?: string;
}

export interface OmittedCourseInfo {
  courseId: string;
  courseName: string;
  reason: string;
}

export interface GeneratedScheduleOption {
  optionIndex: number; // 1 or 2
  signature: string;
  events: ScheduleEvent[];
  includedCourses: IncludedCourseSelection[];
  omittedCourses: OmittedCourseInfo[];
}

interface TimeSlot {
  day: number;
  startHour: number;
  endHour: number;
}

function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  if (a.day !== b.day) return false;
  return a.startHour < b.endHour && b.startHour < a.endHour;
}

function groupFitsOccupied(
  sessions: TimeSlot[],
  occupied: TimeSlot[]
): boolean {
  for (const s of sessions) {
    for (const occ of occupied) {
      if (slotsOverlap(s, occ)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Deterministic Backtracking Automatic Schedule Builder:
 * 1. Respects all mandatory `lockedEvents`.
 * 2. Prioritizes scheduling Lectures for all desired courses first (Stage 1),
 *    and only then schedules Tutorials/Labs for the courses (Stage 2).
 * 3. If a course cannot fit into the combination due to time conflicts, skips it,
 *    completes the rest of the schedule, and tracks it as an "omitted course".
 * 4. Finds up to `maxResults` (2) distinct, non-overlapping schedule combinations,
 *    prioritizing combinations that fit the maximum number of desired courses.
 */
export function generateAutoSchedules(
  desiredCourses: CourseCatalogItem[],
  lockedEvents: ScheduleEvent[],
  colorPalette: string[],
  maxResults = 2
): GeneratedScheduleOption[] {
  if (desiredCourses.length === 0) {
    return [];
  }

  // Initial occupied slots from mandatory locked events
  const baseOccupied: TimeSlot[] = lockedEvents.map((e) => ({
    day: e.day,
    startHour: e.startHour,
    endHour: e.endHour,
  }));

  // Prepare course group buckets (Lectures vs Tutorials vs Labs)
  const preparedCourses = desiredCourses.map((course, idx) => {
    const lectures = course.groups.filter(
      (g) => g.type === 'Lecture' && g.sessions.length > 0
    );
    const tutorials = course.groups.filter(
      (g) => g.type === 'Tutorial' && g.sessions.length > 0
    );
    const labs = course.groups.filter(
      (g) => g.type === 'Lab' && g.sessions.length > 0
    );

    return {
      course,
      color: colorPalette[idx % colorPalette.length],
      lectures,
      tutorials,
      labs,
      hasAnySessions:
        lectures.length > 0 || tutorials.length > 0 || labs.length > 0,
    };
  });

  interface CandidateSolution {
    signature: string;
    events: ScheduleEvent[];
    includedCourses: IncludedCourseSelection[];
    omittedCourses: OmittedCourseInfo[];
  }

  const collectedSolutions: CandidateSolution[] = [];
  const seenSignatures = new Set<string>();
  let bestIncludedCount = -1;
  let nodesVisited = 0;
  const MAX_NODES = 12000;

  interface LectureStageChoice {
    courseIdx: number;
    included: boolean;
    lectureGroup?: CourseCatalogItem['groups'][0];
    omittedReason?: string;
  }

  /**
   * Stage 2: Backtrack over Tutorials (and Labs) after Lectures have been placed.
   */
  function backtrackTutorials(
    listIdx: number,
    lectureChoices: LectureStageChoice[],
    occupied: TimeSlot[],
    chosenTutorials: Map<number, CourseCatalogItem['groups'][0] | undefined>,
    chosenLabs: Map<number, CourseCatalogItem['groups'][0] | undefined>
  ): void {
    if (nodesVisited > MAX_NODES) return;
    nodesVisited++;

    // Stop early if we already have `maxResults` optimal (all-courses-fit) solutions
    if (
      collectedSolutions.length >= maxResults &&
      bestIncludedCount === preparedCourses.length
    ) {
      return;
    }

    if (listIdx >= lectureChoices.length) {
      // All Lectures and Tutorials/Labs have been resolved for this branch!
      buildAndRecordSolution(lectureChoices, chosenTutorials, chosenLabs);
      return;
    }

    const currentChoice = lectureChoices[listIdx];
    const pc = preparedCourses[currentChoice.courseIdx];

    if (!currentChoice.included) {
      // Course was already omitted in Stage 1
      backtrackTutorials(
        listIdx + 1,
        lectureChoices,
        occupied,
        chosenTutorials,
        chosenLabs
      );
      return;
    }

    // Candidate Tutorial groups (or [undefined] if course has no tutorials)
    const tutorialCandidates: (CourseCatalogItem['groups'][0] | undefined)[] =
      pc.tutorials.length > 0 ? pc.tutorials : [undefined];

    // Candidate Lab groups (or [undefined] if course has no labs)
    const labCandidates: (CourseCatalogItem['groups'][0] | undefined)[] =
      pc.labs.length > 0 ? pc.labs : [undefined];

    for (const tutGrp of tutorialCandidates) {
      if (tutGrp && !groupFitsOccupied(tutGrp.sessions, occupied)) {
        continue;
      }
      const nextOccupiedAfterTut = tutGrp
        ? [...occupied, ...tutGrp.sessions]
        : occupied;

      for (const labGrp of labCandidates) {
        if (labGrp && !groupFitsOccupied(labGrp.sessions, nextOccupiedAfterTut)) {
          continue;
        }
        const nextOccupiedAfterLab = labGrp
          ? [...nextOccupiedAfterTut, ...labGrp.sessions]
          : nextOccupiedAfterTut;

        chosenTutorials.set(currentChoice.courseIdx, tutGrp);
        chosenLabs.set(currentChoice.courseIdx, labGrp);

        backtrackTutorials(
          listIdx + 1,
          lectureChoices,
          nextOccupiedAfterLab,
          chosenTutorials,
          chosenLabs
        );

        chosenTutorials.delete(currentChoice.courseIdx);
        chosenLabs.delete(currentChoice.courseIdx);

        if (
          collectedSolutions.length >= maxResults &&
          bestIncludedCount === preparedCourses.length
        ) {
          return;
        }
      }
    }
  }

  /**
   * Stage 1: Backtrack over Lectures for all desired courses first.
   */
  function backtrackLectures(
    courseIdx: number,
    occupied: TimeSlot[],
    lectureChoices: LectureStageChoice[],
    currentIncludedCount: number
  ): void {
    if (nodesVisited > MAX_NODES) return;
    nodesVisited++;

    if (
      collectedSolutions.length >= maxResults &&
      bestIncludedCount === preparedCourses.length
    ) {
      return;
    }

    // Prune branch if even including all remaining courses cannot beat `bestIncludedCount - 1`
    const remainingCourses = preparedCourses.length - courseIdx;
    if (
      collectedSolutions.length >= maxResults &&
      currentIncludedCount + remainingCourses < bestIncludedCount
    ) {
      return;
    }

    if (courseIdx >= preparedCourses.length) {
      // All Lectures placed! Proceed to Stage 2 to schedule Tutorials for all included courses.
      backtrackTutorials(
        0,
        lectureChoices,
        occupied,
        new Map(),
        new Map()
      );
      return;
    }

    const pc = preparedCourses[courseIdx];

    if (!pc.hasAnySessions) {
      // Course has no schedule sessions in catalog -> mark omitted
      lectureChoices.push({
        courseIdx,
        included: false,
        omittedReason: 'No schedule sessions listed in catalog',
      });
      backtrackLectures(
        courseIdx + 1,
        occupied,
        lectureChoices,
        currentIncludedCount
      );
      lectureChoices.pop();
      return;
    }

    const solutionsBeforeInclude = collectedSolutions.length;

    // 1. Try including this course by scheduling one of its Lecture groups first
    if (pc.lectures.length > 0) {
      for (const lecGrp of pc.lectures) {
        if (!groupFitsOccupied(lecGrp.sessions, occupied)) {
          continue;
        }

        lectureChoices.push({
          courseIdx,
          included: true,
          lectureGroup: lecGrp,
        });

        backtrackLectures(
          courseIdx + 1,
          [...occupied, ...lecGrp.sessions],
          lectureChoices,
          currentIncludedCount + 1
        );

        lectureChoices.pop();

        if (
          collectedSolutions.length >= maxResults &&
          bestIncludedCount === preparedCourses.length
        ) {
          return;
        }
      }
    } else {
      // Course has only Tutorials/Labs and no Lectures
      lectureChoices.push({
        courseIdx,
        included: true,
        lectureGroup: undefined,
      });

      backtrackLectures(
        courseIdx + 1,
        occupied,
        lectureChoices,
        currentIncludedCount + 1
      );

      lectureChoices.pop();
    }

    // 2. Overlap Fallback: If this course could not fit (or to explore omitting it when needed),
    // skip it, mark it as an omitted course due to time conflicts, and complete the rest of the schedule.
    const foundEnoughWithCourse =
      collectedSolutions.length - solutionsBeforeInclude >= maxResults;

    if (!foundEnoughWithCourse) {
      lectureChoices.push({
        courseIdx,
        included: false,
        omittedReason:
          'Time conflict with other selected courses or locked events',
      });

      backtrackLectures(
        courseIdx + 1,
        occupied,
        lectureChoices,
        currentIncludedCount
      );

      lectureChoices.pop();
    }
  }

  function buildAndRecordSolution(
    lectureChoices: LectureStageChoice[],
    chosenTutorials: Map<number, CourseCatalogItem['groups'][0] | undefined>,
    chosenLabs: Map<number, CourseCatalogItem['groups'][0] | undefined>
  ) {
    const includedCourses: IncludedCourseSelection[] = [];
    const omittedCourses: OmittedCourseInfo[] = [];
    const generatedEvents: ScheduleEvent[] = [...lockedEvents];
    const sigParts: string[] = [];

    for (const choice of lectureChoices) {
      const pc = preparedCourses[choice.courseIdx];
      const { course, color } = pc;

      if (!choice.included) {
        omittedCourses.push({
          courseId: course.courseId,
          courseName: course.name,
          reason:
            choice.omittedReason ||
            'Time conflict with other courses or locked events',
        });
        sigParts.push(`${course.courseId}:OMITTED`);
        continue;
      }

      const lecGrp = choice.lectureGroup;
      const tutGrp = chosenTutorials.get(choice.courseIdx);
      const labGrp = chosenLabs.get(choice.courseIdx);

      includedCourses.push({
        courseId: course.courseId,
        courseName: course.name,
        lectureGroupId: lecGrp?.groupId,
        tutorialGroupId: tutGrp?.groupId,
        labGroupId: labGrp?.groupId,
      });

      sigParts.push(
        `${course.courseId}:L=${lecGrp?.groupId || '-'}:T=${
          tutGrp?.groupId || '-'
        }:B=${labGrp?.groupId || '-'}`
      );

      const selectedGroups = [lecGrp, tutGrp, labGrp].filter(
        (g): g is CourseCatalogItem['groups'][0] => Boolean(g)
      );

      for (const grp of selectedGroups) {
        grp.sessions.forEach((s, idx) => {
          generatedEvents.push({
            id: `${course.courseId}-${grp.type}-${grp.groupId}-${s.day}-${s.startHour}-${idx}`,
            courseId: course.courseId,
            title: course.name,
            type: grp.type,
            groupId: grp.groupId,
            lecturer: grp.lecturer,
            location: s.location,
            day: s.day,
            startHour: s.startHour,
            endHour: s.endHour,
            color,
          });
        });
      }
    }

    const signature = sigParts.join('|');
    if (seenSignatures.has(signature)) {
      return;
    }
    seenSignatures.add(signature);

    if (includedCourses.length > bestIncludedCount) {
      bestIncludedCount = includedCourses.length;
    }

    collectedSolutions.push({
      signature,
      events: generatedEvents,
      includedCourses,
      omittedCourses,
    });
  }

  // Run 2-stage deterministic backtracking
  backtrackLectures(0, baseOccupied, [], 0);

  // Sort solutions by most included courses first (fewest omitted courses)
  collectedSolutions.sort(
    (a, b) => b.includedCourses.length - a.includedCourses.length
  );

  return collectedSolutions.slice(0, maxResults).map((sol, idx) => ({
    optionIndex: idx + 1,
    signature: sol.signature,
    events: sol.events,
    includedCourses: sol.includedCourses,
    omittedCourses: sol.omittedCourses,
  }));
}

