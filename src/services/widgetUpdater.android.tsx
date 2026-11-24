// src/services/widgetUpdater.android.tsx
import React from 'react';
import { Platform } from 'react-native';
import {
  registerWidgetTaskHandler,
  requestWidgetUpdate,
  type WidgetTaskHandlerProps,
} from 'react-native-android-widget';
import { DailyScheduleWidget } from '../widgets/DailyScheduleWidget.android';
import { FreeTimeWidget } from '../widgets/FreeTimeWidget.android';
import { loadAndroidWidgetSnapshot } from '../widgets/widgetDataHelper.android';

let isTaskHandlerRegistered = false;

async function handleAndroidWidgetTask({
  widgetInfo,
  widgetAction,
  renderWidget,
}: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED') {
    return;
  }

  if (
    widgetAction === 'WIDGET_ADDED' ||
    widgetAction === 'WIDGET_UPDATE' ||
    widgetAction === 'WIDGET_RESIZED' ||
    widgetAction === 'WIDGET_CLICK'
  ) {
    try {
      const snapshot = await loadAndroidWidgetSnapshot();
      switch (widgetInfo.widgetName) {
        case 'DailyScheduleWidget':
          renderWidget(<DailyScheduleWidget snapshot={snapshot} />);
          break;
        case 'FreeTimeWidget':
          renderWidget(
            <FreeTimeWidget hasFreeTime={snapshot.hasFreeTimeInWindow} />
          );
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn('Android widget task handler error:', err);
    }
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

// Automatically register on Android when module is imported
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
        renderWidget: () => <DailyScheduleWidget snapshot={snapshot} />,
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
