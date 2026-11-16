// src/utils/overlapLayout.ts
import { ScheduleEvent, PositionedEvent } from '../types/schedule';

/**
 * Groups overlapping events on a single day into connected clusters and assigns
 * each event a `colIndex` and `totalCols` so they render side-by-side without breaking layout.
 */
export function layoutDayEvents(dayEvents: ScheduleEvent[]): PositionedEvent[] {
  if (dayEvents.length === 0) return [];

  // Sort by start time ascending, then by longest duration
  const sorted = [...dayEvents].sort((a, b) =>
    a.startHour !== b.startHour ? a.startHour - b.startHour : b.endHour - a.endHour
  );

  // Group into connected overlap clusters
  const clusters: ScheduleEvent[][] = [];
  let currentCluster: ScheduleEvent[] = [];
  let clusterMaxEnd = -1;

  for (const ev of sorted) {
    if (currentCluster.length === 0 || ev.startHour < clusterMaxEnd) {
      currentCluster.push(ev);
      clusterMaxEnd = Math.max(clusterMaxEnd, ev.endHour);
    } else {
      clusters.push(currentCluster);
      currentCluster = [ev];
      clusterMaxEnd = ev.endHour;
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  // Assign columns within each cluster
  const result: PositionedEvent[] = [];

  for (const cluster of clusters) {
    const columnsEndHours: number[] = []; // Tracks the end hour of the last event in each column
    const tempAssigned: { event: ScheduleEvent; colIndex: number }[] = [];

    for (const ev of cluster) {
      let placedCol = columnsEndHours.findIndex((endHour) => endHour <= ev.startHour);
      if (placedCol === -1) {
        placedCol = columnsEndHours.length;
        columnsEndHours.push(ev.endHour);
      } else {
        columnsEndHours[placedCol] = ev.endHour;
      }
      tempAssigned.push({ event: ev, colIndex: placedCol });
    }

    const totalCols = columnsEndHours.length;
    for (const item of tempAssigned) {
      result.push({
        ...item.event,
        colIndex: item.colIndex,
        totalCols,
      });
    }
  }

  return result;
}

