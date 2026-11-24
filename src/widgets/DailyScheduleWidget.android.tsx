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

function renderEventItemRow(
  item: Extract<WidgetTimelineListItem, { kind: 'event' }>,
  idx: number,
  showTimeAxis: boolean
) {
  const { event, color, timeRangeLabel, ongoingProgress, axisHourLabels } =
    item;
  const durationHours = Math.max(0.5, event.endHour - event.startHour);
  const cardHeight = Math.max(
    MIN_CARD_HEIGHT,
    Math.round(durationHours * PIXELS_PER_HOUR_WIDGET)
  );

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
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 5,
      }}
    >
      <TextWidget
        text={timeRangeLabel}
        maxLines={1}
        style={{
          color: '#F3F4F6',
          fontSize: 9,
          fontWeight: 'bold',
        }}
      />
      <TextWidget
        text={event.title || 'Class'}
        maxLines={1}
        truncate="END"
        style={{
          color: '#FFFFFF',
          fontSize: 11,
          fontWeight: 'bold',
        }}
      />
      <TextWidget
        text={subLine || event.lecturer || '—'}
        maxLines={1}
        truncate="END"
        style={{
          color: '#E5E7EB',
          fontSize: 9.5,
        }}
      />
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
                4,
                Math.min(
                  cardHeight - 8,
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

  if (!showTimeAxis) {
    return (
      <FlexWidget
        key={`ev-${event.id}-${idx}`}
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          paddingVertical: 2,
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
        paddingVertical: 2,
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
            axisHourLabels.length > 1 ? 'space-between' : 'flex-start',
          paddingTop: 2,
          paddingBottom: 2,
          paddingRight: 4,
        }}
      >
        {axisHourLabels.map((lbl, hIdx) => (
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

export function DailyScheduleWidget({ snapshot }: DailyScheduleWidgetProps) {
  const dayHeaderLabel = snapshot?.dayHeaderLabel || 'Today';
  const pinnedTodayTasks = Array.isArray(snapshot?.pinnedTodayTasks)
    ? snapshot.pinnedTodayTasks
    : [];
  const timelineItems = Array.isArray(snapshot?.timelineItems)
    ? snapshot.timelineItems
    : [];
  const showTimeAxis = Boolean(snapshot?.widgetShowTimeAxis);
  const hasEvents = timelineItems.some((item) => item.kind === 'event');

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

      {/* Scrollable Vertical Events Strip (ListWidget) with Clean Gray Timeline Indicator */}
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
      ) : (
        <ListWidget
          style={{
            height: 'match_parent',
            width: 'match_parent',
            backgroundColor: '#1E1E2E',
          }}
        >
          {timelineItems.map((item, idx) => {
            if (item.kind === 'now') {
              return (
                <FlexWidget
                  key={`timeline-now-${idx}`}
                  clickAction="OPEN_APP"
                  style={{
                    width: 'match_parent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 4,
                    backgroundColor: '#1E1E2E',
                  }}
                >
                  {showTimeAxis && (
                    <FlexWidget
                      style={{
                        width: TIME_AXIS_WIDTH,
                        height: 8,
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

            return renderEventItemRow(item, idx, showTimeAxis);
          })}
        </ListWidget>
      )}
    </FlexWidget>
  );
}
