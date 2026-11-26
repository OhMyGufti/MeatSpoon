'use no memo';
// src/services/widgetUpdater.native.tsx
import React from 'react';
import { Platform } from 'react-native';
import {
  FlexWidget,
  TextWidget,
  registerWidgetTaskHandler,
  requestWidgetUpdate,
  type WidgetTaskHandlerProps,
} from 'react-native-android-widget';
import { DailyScheduleWidget } from '../widgets/DailyScheduleWidget.android';
import { FreeTimeWidget } from '../widgets/FreeTimeWidget.android';
import { loadAndroidWidgetSnapshot } from '../widgets/widgetDataHelper.android';

let isTaskHandlerRegistered = false;

function renderErrorFallbackWidget(errorMessage: string) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1E1E2E',
        borderRadius: 16,
        padding: 8,
      }}
    >
      <TextWidget
        text="🥄 MeatSpoon"
        style={{
          color: '#F9FAFB',
          fontSize: 11,
          fontWeight: 'bold',
        }}
      />
      <TextWidget
        text={errorMessage || 'Tap to open app'}
        maxLines={2}
        truncate="END"
        style={{
          color: '#FCA5A5',
          fontSize: 9,
          textAlign: 'center',
        }}
      />
    </FlexWidget>
  );
}

async function handleAndroidWidgetTask(
  props: WidgetTaskHandlerProps
): Promise<void> {
  const { widgetInfo, widgetAction, renderWidget } = props;
  if (widgetAction === 'WIDGET_DELETED') {
    return;
  }

  try {
    const snapshot = await loadAndroidWidgetSnapshot();

    switch (widgetInfo.widgetName) {
      case 'DailyScheduleWidget':
        renderWidget(
          <DailyScheduleWidget
            snapshot={snapshot}
            widgetHeightDp={widgetInfo.height}
          />
        );
        break;
      case 'FreeTimeWidget':
        renderWidget(
          <FreeTimeWidget hasFreeTime={snapshot.hasFreeTimeInWindow} />
        );
        break;
      default:
        renderWidget(
          renderErrorFallbackWidget(`Unknown widget: ${widgetInfo.widgetName}`)
        );
        break;
    }
  } catch (err: any) {
    console.warn('Android widget task handler error:', err);
    try {
      const msg =
        err && typeof err.message === 'string'
          ? err.message
          : 'Widget sync error';
      renderWidget(renderErrorFallbackWidget(msg));
    } catch {}
  }
}

export function initAndroidWidgetTaskHandler(): void {
  if (Platform.OS !== 'android' || isTaskHandlerRegistered) {
    return;
  }
  try {
    registerWidgetTaskHandler(handleAndroidWidgetTask);
    isTaskHandlerRegistered = true;
  } catch (err) {
    console.warn('Failed to register Android widget task handler:', err);
  }
}

// Register immediately at module load on Android
initAndroidWidgetTaskHandler();

export async function refreshAllWidgets(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    const snapshot = await loadAndroidWidgetSnapshot();
    await Promise.all([
      requestWidgetUpdate({
        widgetName: 'DailyScheduleWidget',
        renderWidget: (info) => (
          <DailyScheduleWidget
            snapshot={snapshot}
            widgetHeightDp={info.height}
          />
        ),
      }),
      requestWidgetUpdate({
        widgetName: 'FreeTimeWidget',
        renderWidget: () => (
          <FreeTimeWidget hasFreeTime={snapshot.hasFreeTimeInWindow} />
        ),
      }),
    ]);
  } catch (err) {
    console.warn('Failed to refresh Android widgets:', err);
  }
}
