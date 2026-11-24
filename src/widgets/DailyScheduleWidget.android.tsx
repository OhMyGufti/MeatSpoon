// src/widgets/DailyScheduleWidget.android.tsx
import React from 'react';
import {
  FlexWidget,
  ListWidget,
  TextWidget,
} from 'react-native-android-widget';
import type { AndroidWidgetSnapshot } from './widgetDataHelper.android';

export interface DailyScheduleWidgetProps {
  snapshot: AndroidWidgetSnapshot;
}

export function DailyScheduleWidget({ snapshot }: DailyScheduleWidgetProps) {
  const { dayHeaderLabel, pinnedTodayTasks, timelineItems } = snapshot;
  const hasEvents = timelineItems.some((item) => item.kind === 'event');

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="MeatSpoon Daily Schedule"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: '#111827',
        borderRadius: 16,
        padding: 8,
      }}
    >
      {/* Compact Day Header Bar */}
      <FlexWidget
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 4,
          paddingBottom: 6,
          borderBottomWidth: 1,
          borderBottomColor: '#1F2937',
        }}
      >
        <TextWidget
          text={`🥄 ${dayHeaderLabel}`}
          style={{
            color: '#F9FAFB',
            fontSize: 12,
            fontWeight: 'bold',
          }}
        />
        {pinnedTodayTasks.length > 0 && (
          <TextWidget
            text={`${pinnedTodayTasks.length} due`}
            style={{
              color: '#93C5FD',
              fontSize: 10,
              fontWeight: 'bold',
            }}
          />
        )}
      </FlexWidget>

      {/* Top Pinned Tasks Bar (Non-Scrolling): compact colored pills matching calendar day header */}
      {pinnedTodayTasks.length > 0 && (
        <FlexWidget
          clickAction="OPEN_APP"
          style={{
            width: 'match_parent',
            flexDirection: 'column',
            paddingTop: 5,
            paddingBottom: 5,
            borderBottomWidth: 1,
            borderBottomColor: '#1F2937',
            flexGap: 3,
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
                backgroundColor: tsk.color,
                borderRadius: 5,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.45)',
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
                text={tsk.dueTimeLabel}
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

      {/* Scrollable Vertical Events Strip (ListWidget) with Chronological Gray Timeline Indicator */}
      {!hasEvents ? (
        <FlexWidget
          clickAction="OPEN_APP"
          style={{
            width: 'match_parent',
            flex: 1,
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 10,
          }}
        >
          {/* Current-Time Gray Timeline Indicator */}
          {timelineItems
            .filter((i) => i.kind === 'now')
            .map((nowItem, idx) => (
              <FlexWidget
                key={`now-empty-${idx}`}
                clickAction="OPEN_APP"
                style={{
                  width: 'match_parent',
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <FlexWidget
                  style={{
                    backgroundColor: 'rgba(156, 163, 175, 0.35)',
                    borderRadius: 4,
                    paddingHorizontal: 5,
                    paddingVertical: 1.5,
                  }}
                >
                  <TextWidget
                    text={nowItem.currentTimeLabel}
                    style={{
                      color: '#D1D5DB',
                      fontSize: 9,
                      fontWeight: 'bold',
                    }}
                  />
                </FlexWidget>
                <FlexWidget
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: '#9CA3AF',
                    marginLeft: 2,
                  }}
                />
                <FlexWidget
                  style={{
                    flex: 1,
                    height: 2,
                    backgroundColor: 'rgba(156, 163, 175, 0.55)',
                  }}
                />
              </FlexWidget>
            ))}
          <TextWidget
            text="No classes scheduled today"
            style={{
              color: '#9CA3AF',
              fontSize: 11,
              textAlign: 'center',
            }}
          />
        </FlexWidget>
      ) : (
        <ListWidget
          style={{
            height: 'match_parent',
            width: 'match_parent',
            backgroundColor: '#111827',
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
                  }}
                >
                  <FlexWidget
                    style={{
                      backgroundColor: 'rgba(156, 163, 175, 0.35)',
                      borderRadius: 4,
                      paddingHorizontal: 5,
                      paddingVertical: 1.5,
                    }}
                  >
                    <TextWidget
                      text={item.currentTimeLabel}
                      style={{
                        color: '#E5E7EB',
                        fontSize: 9,
                        fontWeight: 'bold',
                      }}
                    />
                  </FlexWidget>
                  <FlexWidget
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: '#9CA3AF',
                      marginLeft: 2,
                    }}
                  />
                  <FlexWidget
                    style={{
                      flex: 1,
                      height: 2,
                      backgroundColor: 'rgba(156, 163, 175, 0.55)',
                    }}
                  />
                </FlexWidget>
              );
            }

            const { event, color, timeRangeLabel } = item;
            const subLine = [
              event.type,
              event.location && event.location !== '—' ? event.location : null,
            ]
              .filter(Boolean)
              .join(' • ');

            return (
              <FlexWidget
                key={`ev-${event.id}-${idx}`}
                clickAction="OPEN_APP"
                style={{
                  width: 'match_parent',
                  flexDirection: 'column',
                  backgroundColor: color,
                  borderRadius: 7,
                  paddingHorizontal: 7,
                  paddingVertical: 5,
                  marginVertical: 2,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.35)',
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
                  text={event.title}
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
          })}
        </ListWidget>
      )}
    </FlexWidget>
  );
}
