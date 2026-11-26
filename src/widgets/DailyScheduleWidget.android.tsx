'use no memo';
// src/widgets/DailyScheduleWidget.android.tsx
import React from 'react';
import {
  FlexWidget,
  ListWidget,
  OverlapWidget,
  TextWidget,
} from 'react-native-android-widget';
import type {
  AndroidWidgetSnapshot,
  WidgetTimelineListItem,
} from './widgetDataHelper.android';

export interface DailyScheduleWidgetProps {
  snapshot: AndroidWidgetSnapshot;
  widgetHeightDp?: number;
}

const TIME_AXIS_WIDTH = 34;
const PIXELS_PER_HOUR_WIDGET = 52;
const MIN_CARD_HEIGHT = 56;

/**
 * Renders the clean gray timeline indicator (dot + horizontal gray line, NO time text).
 */
function renderCleanGrayTimelineBar() {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <FlexWidget
        style={{
          width: 7,
          height: 7,
          borderRadius: 3.5,
          backgroundColor: '#D1D5DB',
        }}
      />
      <FlexWidget
        style={{
          width: 'match_parent',
          height: 2,
          backgroundColor: '#9CA3AF',
        }}
      />
    </FlexWidget>
  );
}

/**
 * Renders a visual spacer row between two non-consecutive events (with optional gray timeline inside if `now` falls in the gap).
 */
function renderGapSpacerRow(
  item: Extract<WidgetTimelineListItem, { kind: 'gap' }>,
  idx: number,
  showTimeAxis: boolean,
  explicitGapHeightDp?: number
) {
  const gapHeight =
    typeof explicitGapHeightDp === 'number'
      ? Math.max(10, Math.round(explicitGapHeightDp))
      : Math.max(16, Math.min(28, Math.round(14 + item.durationHours * 4)));

  const hasNowInGap = typeof item.nowProgress === 'number';
  const nowTopOffset = hasNowInGap
    ? Math.max(
        2,
        Math.min(
          Math.max(2, gapHeight - 7),
          Math.round((item.nowProgress || 0.5) * (gapHeight - 7))
        )
      )
    : 0;

  const gapBody = hasNowInGap ? (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: gapHeight,
        flexDirection: 'column',
      }}
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          height: nowTopOffset,
        }}
      />
      {renderCleanGrayTimelineBar()}
    </FlexWidget>
  ) : (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: gapHeight,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <FlexWidget
        style={{
          width: 18,
          height: 2,
          borderRadius: 1,
          backgroundColor: '#374151',
        }}
      />
    </FlexWidget>
  );

  if (!showTimeAxis) {
    return (
      <FlexWidget
        key={`gap-${idx}`}
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          height: gapHeight,
          backgroundColor: '#1E1E2E',
        }}
      >
        {gapBody}
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      key={`gap-${idx}`}
      clickAction="OPEN_APP"
      style={{
        width: 'match_parent',
        height: gapHeight,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1E1E2E',
      }}
    >
      {/* Keep Side Time Axis Column clean across the gap */}
      <FlexWidget
        style={{
          width: TIME_AXIS_WIDTH,
          height: gapHeight,
        }}
      />
      <FlexWidget
        style={{
          flex: 1,
          width: 'match_parent',
          height: gapHeight,
        }}
      >
        {gapBody}
      </FlexWidget>
    </FlexWidget>
  );
}

function renderEventItemRow(
  item: Extract<WidgetTimelineListItem, { kind: 'event' }>,
  idx: number,
  showTimeAxis: boolean,
  explicitCardHeightDp?: number,
  rowPaddingVertical = 2
) {
  const { event, color, timeRangeLabel, ongoingProgress, axisHourLabels } =
    item;
  const durationHours = Math.max(0.5, event.endHour - event.startHour);
  const cardHeight =
    typeof explicitCardHeightDp === 'number'
      ? Math.max(28, Math.round(explicitCardHeightDp))
      : Math.max(
          MIN_CARD_HEIGHT,
          Math.round(durationHours * PIXELS_PER_HOUR_WIDGET)
        );

  const isCompactFitCard = cardHeight < 44;
  const isVeryCompactFitCard = cardHeight < 34;

  const subLine = [
    event.type,
    event.location && event.location !== '—' ? event.location : null,
  ]
    .filter(Boolean)
    .join(' • ');

  const eventCardBody = (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        width: 'match_parent',
        height: cardHeight,
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: color || '#2563EB',
        borderRadius: isCompactFitCard ? 6 : 8,
        paddingHorizontal: isCompactFitCard ? 6 : 8,
        paddingVertical: isCompactFitCard ? 2 : 5,
      }}
    >
      <TextWidget
        text={
          isVeryCompactFitCard
            ? `${timeRangeLabel} • ${event.title || 'Class'}`
            : timeRangeLabel
        }
        maxLines={1}
        truncate="END"
        style={{
          color: '#F3F4F6',
          fontSize: isCompactFitCard ? 8.5 : 9,
          fontWeight: 'bold',
        }}
      />
      {!isVeryCompactFitCard && (
        <TextWidget
          text={event.title || 'Class'}
          maxLines={1}
          truncate="END"
          style={{
            color: '#FFFFFF',
            fontSize: isCompactFitCard ? 10 : 11,
            fontWeight: 'bold',
          }}
        />
      )}
      {!isCompactFitCard && (
        <TextWidget
          text={subLine || event.lecturer || '—'}
          maxLines={1}
          truncate="END"
          style={{
            color: '#E5E7EB',
            fontSize: 9.5,
          }}
        />
      )}
    </FlexWidget>
  );

  // If `now` is inside this ongoing event, overlay the gray timeline bar across the card via OverlapWidget
  const cardWithOptionalOverlay =
    typeof ongoingProgress === 'number' ? (
      <OverlapWidget
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          height: cardHeight,
        }}
      >
        {eventCardBody}
        <FlexWidget
          style={{
            width: 'match_parent',
            height: cardHeight,
            flexDirection: 'column',
          }}
        >
          <FlexWidget
            style={{
              width: 'match_parent',
              height: Math.max(
                3,
                Math.min(
                  Math.max(3, cardHeight - 7),
                  Math.round(ongoingProgress * cardHeight)
                )
              ),
            }}
          />
          {renderCleanGrayTimelineBar()}
        </FlexWidget>
      </OverlapWidget>
    ) : (
      eventCardBody
    );

  const visibleAxisLabels =
    isCompactFitCard && axisHourLabels.length > 1
      ? [axisHourLabels[0]]
      : axisHourLabels;

  if (!showTimeAxis) {
    return (
      <FlexWidget
        key={`ev-${event.id}-${idx}`}
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          paddingVertical: rowPaddingVertical,
          backgroundColor: '#1E1E2E',
        }}
      >
        {cardWithOptionalOverlay}
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      key={`ev-${event.id}-${idx}`}
      clickAction="OPEN_APP"
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: rowPaddingVertical,
        backgroundColor: '#1E1E2E',
      }}
    >
      {/* Slim Left Side Time Axis Column */}
      <FlexWidget
        style={{
          width: TIME_AXIS_WIDTH,
          height: cardHeight,
          flexDirection: 'column',
          justifyContent:
            visibleAxisLabels.length > 1 ? 'space-between' : 'flex-start',
          paddingTop: 2,
          paddingBottom: 2,
          paddingRight: 4,
        }}
      >
        {visibleAxisLabels.map((lbl, hIdx) => (
          <TextWidget
            key={`ax-${idx}-${hIdx}`}
            text={lbl}
            maxLines={1}
            style={{
              color: '#9CA3AF',
              fontSize: 8.5,
              fontWeight: 'bold',
            }}
          />
        ))}
      </FlexWidget>

      {/* Right Event Card Column */}
      <FlexWidget
        style={{
          flex: 1,
          width: 'match_parent',
          height: cardHeight,
        }}
      >
        {cardWithOptionalOverlay}
      </FlexWidget>
    </FlexWidget>
  );
}

/**
 * Computes fitted item heights when `widgetFitToLength` is enabled so all of today's
 * events, gaps, and timeline rows fit inside the available widget height without scrolling.
 */
function computeFittedItemHeights(
  timelineItems: WidgetTimelineListItem[],
  widgetHeightDp: number,
  pinnedTasksCount: number
): number[] {
  const effectiveTotalH =
    widgetHeightDp && widgetHeightDp > 80 ? widgetHeightDp : 240;
  const outerPad = 16; // 8 top + 8 bottom
  const headerBarH = 31; // header height + marginBottom
  const visiblePinnedCount = Math.min(3, pinnedTasksCount);
  const pinnedBarH =
    visiblePinnedCount > 0 ? visiblePinnedCount * 19 + 6 : 0;

  const availableBodyH = Math.max(
    80,
    effectiveTotalH - outerPad - headerBarH - pinnedBarH
  );

  // Reserve fixed height for standalone 'now' rows and 2dp vertical padding per event row
  let fixedReservedH = 0;
  const rawWeights: number[] = [];

  for (const item of timelineItems) {
    if (item.kind === 'now') {
      fixedReservedH += 11;
      rawWeights.push(0);
    } else if (item.kind === 'gap') {
      // Subtle gap weight proportional to gap duration, clamped
      const gapW = Math.max(0.28, Math.min(0.85, item.durationHours * 0.3));
      rawWeights.push(gapW);
    } else {
      fixedReservedH += 2; // 1dp top + 1dp bottom row padding in fit mode
      const dur = Math.max(0.75, item.event.endHour - item.event.startHour);
      rawWeights.push(dur);
    }
  }

  const distributableH = Math.max(48, availableBodyH - fixedReservedH);
  const totalWeight = rawWeights.reduce((acc, w) => acc + w, 0) || 1;

  return timelineItems.map((item, idx) => {
    if (item.kind === 'now') {
      return 11;
    }
    const share = (rawWeights[idx] / totalWeight) * distributableH;
    if (item.kind === 'gap') {
      return Math.max(10, Math.min(26, Math.round(share)));
    }
    return Math.max(28, Math.round(share));
  });
}

export function DailyScheduleWidget({
  snapshot,
  widgetHeightDp = 240,
}: DailyScheduleWidgetProps) {
  const dayHeaderLabel = snapshot?.dayHeaderLabel || 'Today';
  const pinnedTodayTasks = Array.isArray(snapshot?.pinnedTodayTasks)
    ? snapshot.pinnedTodayTasks
    : [];
  const timelineItems = Array.isArray(snapshot?.timelineItems)
    ? snapshot.timelineItems
    : [];
  const showTimeAxis = Boolean(snapshot?.widgetShowTimeAxis);
  const fitToLength = Boolean(snapshot?.widgetFitToLength);
  const hasEvents = timelineItems.some((item) => item.kind === 'event');

  const fittedHeights =
    fitToLength && hasEvents
      ? computeFittedItemHeights(
          timelineItems,
          widgetHeightDp,
          pinnedTodayTasks.length
        )
      : null;

  const renderTimelineItem = (
    item: WidgetTimelineListItem,
    idx: number
  ) => {
    if (item.kind === 'now') {
      return (
        <FlexWidget
          key={`timeline-now-${idx}`}
          clickAction="OPEN_APP"
          style={{
            width: 'match_parent',
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: fitToLength ? 2 : 4,
            backgroundColor: '#1E1E2E',
          }}
        >
          {showTimeAxis && (
            <FlexWidget
              style={{
                width: TIME_AXIS_WIDTH,
                height: 7,
              }}
            />
          )}
          <FlexWidget
            style={{
              flex: 1,
              width: 'match_parent',
            }}
          >
            {renderCleanGrayTimelineBar()}
          </FlexWidget>
        </FlexWidget>
      );
    }

    if (item.kind === 'gap') {
      return renderGapSpacerRow(
        item,
        idx,
        showTimeAxis,
        fittedHeights ? fittedHeights[idx] : undefined
      );
    }

    return renderEventItemRow(
      item,
      idx,
      showTimeAxis,
      fittedHeights ? fittedHeights[idx] : undefined,
      fitToLength ? 1 : 2
    );
  };

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="MeatSpoon Daily Schedule"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: '#1E1E2E',
        borderRadius: 16,
        padding: 8,
      }}
    >
      {/* Top Header Bar */}
      <FlexWidget
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#111827',
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 5,
          marginBottom: 5,
        }}
      >
        <TextWidget
          text={`🥄 ${dayHeaderLabel}`}
          maxLines={1}
          truncate="END"
          style={{
            color: '#F9FAFB',
            fontSize: 12,
            fontWeight: 'bold',
          }}
        />
        <TextWidget
          text={
            pinnedTodayTasks.length > 0
              ? `${pinnedTodayTasks.length} due`
              : 'MeatSpoon'
          }
          maxLines={1}
          style={{
            color: '#93C5FD',
            fontSize: 10,
            fontWeight: 'bold',
          }}
        />
      </FlexWidget>

      {/* Top Pinned Tasks Bar (Non-Scrolling): compact colored pills matching calendar day header */}
      {pinnedTodayTasks.length > 0 && (
        <FlexWidget
          clickAction="OPEN_APP"
          style={{
            width: 'match_parent',
            flexDirection: 'column',
            marginBottom: 5,
            flexGap: 3,
            flexGapColor: '#1E1E2E',
          }}
        >
          {pinnedTodayTasks.slice(0, 3).map((tsk) => (
            <FlexWidget
              key={`pin-tsk-${tsk.id}`}
              clickAction="OPEN_APP"
              style={{
                width: 'match_parent',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: tsk.color || '#2563EB',
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 3,
              }}
            >
              <TextWidget
                text={`📌 ${tsk.title}`}
                maxLines={1}
                truncate="END"
                style={{
                  color: '#FFFFFF',
                  fontSize: 9.5,
                  fontWeight: 'bold',
                }}
              />
              <TextWidget
                text={tsk.dueTimeLabel || ''}
                maxLines={1}
                style={{
                  color: '#F3F4F6',
                  fontSize: 8.5,
                  fontWeight: 'bold',
                }}
              />
            </FlexWidget>
          ))}
        </FlexWidget>
      )}

      {/* Main Events Area: Empty State vs Non-Scrolling Fit-to-Length FlexWidget vs Scrollable ListWidget */}
      {!hasEvents ? (
        <FlexWidget
          clickAction="OPEN_APP"
          style={{
            width: 'match_parent',
            height: 'match_parent',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#181825',
            borderRadius: 10,
            padding: 10,
          }}
        >
          <FlexWidget
            style={{
              width: 'match_parent',
              marginBottom: 10,
            }}
          >
            {renderCleanGrayTimelineBar()}
          </FlexWidget>
          <TextWidget
            text="No classes scheduled today"
            style={{
              color: '#D1D5DB',
              fontSize: 11,
              fontWeight: 'bold',
              textAlign: 'center',
            }}
          />
          <TextWidget
            text="Tap to open MeatSpoon"
            style={{
              color: '#9CA3AF',
              fontSize: 9.5,
              textAlign: 'center',
              marginTop: 3,
            }}
          />
        </FlexWidget>
      ) : fitToLength ? (
        <FlexWidget
          clickAction="OPEN_APP"
          style={{
            height: 'match_parent',
            width: 'match_parent',
            flexDirection: 'column',
            justifyContent: 'space-between',
            backgroundColor: '#1E1E2E',
          }}
        >
          {timelineItems.map((item, idx) => renderTimelineItem(item, idx))}
        </FlexWidget>
      ) : (
        <ListWidget
          style={{
            height: 'match_parent',
            width: 'match_parent',
            backgroundColor: '#1E1E2E',
          }}
        >
          {timelineItems.map((item, idx) => renderTimelineItem(item, idx))}
        </ListWidget>
      )}
    </FlexWidget>
  );
}
