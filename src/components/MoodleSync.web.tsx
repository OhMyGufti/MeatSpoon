import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {
  PersistedStateSnapshot,
  parseMoodleSyncPayload,
  persistMoodleTasksToStorage,
} from '../services/moodleSync';
import { MoodleSyncProps } from './MoodleSync.types';

/**
 * Web / PWA Moodle Sync component.
 * Supports uploading a local `.ics` file via `expo-document-picker` (zero network/CORS)
 * as well as syncing a saved Moodle iCal export URL through a CORS proxy.
 */
export default function MoodleSync({
  mode,
  events,
  catalog,
  tasks,
  dismissedTaskIds,
  desiredCourseIds,
  lockedEvents,
  hiddenKeys,
  includedSpecialGroups,
  autoOpenMoodleLogin,
  moodleIcalUrl,
  onChangeMoodleIcalUrl,
  isHydratingStorage,
  onCloseSettings,
  onTasksSynced,
  onShowToast,
}: MoodleSyncProps) {
  const [syncing, setSyncing] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  if (mode !== 'settings') {
    return null;
  }

  const buildStateSnapshot = (): PersistedStateSnapshot => ({
    events,
    tasks,
    dismissedTaskIds,
    desiredCourseIds,
    lockedEvents,
    hiddenKeys,
    includedSpecialGroups,
    autoOpenMoodleLogin,
    moodleIcalUrl,
  });

  const importAndPersistIcsText = async (
    icsText: string,
    source: 'url' | 'file'
  ): Promise<boolean> => {
    if (!icsText || !icsText.includes('BEGIN:VCALENDAR')) {
      onShowToast(
        source === 'file'
          ? 'Invalid .ics file. Please export your Moodle calendar (.ics) and try again.'
          : 'Invalid Moodle iCal response. Verify your Moodle iCal Export URL.',
        'warning'
      );
      return false;
    }

    const syncedTasks = parseMoodleSyncPayload(icsText, events, catalog);
    if (syncedTasks.length === 0) {
      onShowToast(
        source === 'file'
          ? 'Moodle .ics imported: 0 upcoming tasks found in file.'
          : 'Moodle sync complete: 0 upcoming tasks found in iCal feed.',
        'success'
      );
      return true;
    }

    const { newlyAddedCount, updatedDismissedIds } =
      await persistMoodleTasksToStorage(
        syncedTasks,
        buildStateSnapshot(),
        isHydratingStorage
      );
    onTasksSynced(syncedTasks, updatedDismissedIds);

    onShowToast(
      `Synced ${syncedTasks.length} Moodle task(s) (${newlyAddedCount} new added).`,
      'success'
    );
    return true;
  };

  const handleUploadMoodleIcsFile = async () => {
    if (syncing) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'web' ? ['.ics', 'text/calendar'] : '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      setSyncing(true);
      const asset = result.assets[0];
      let icsText = '';

      if (asset.file && typeof asset.file.text === 'function') {
        icsText = await asset.file.text();
      } else if (asset.uri) {
        const fileResponse = await fetch(asset.uri);
        icsText = await fileResponse.text();
      }

      const imported = await importAndPersistIcsText(icsText, 'file');
      if (imported) {
        onCloseSettings();
      }
    } catch (err: any) {
      console.warn('Manual .ics upload error:', err);
      onShowToast(
        err?.message || 'Failed to read selected .ics file.',
        'warning'
      );
    } finally {
      if (isMountedRef.current) {
        setSyncing(false);
      }
    }
  };

  const handleWebMoodleIcalSync = async () => {
    const trimmedUrl = moodleIcalUrl.trim();
    if (!trimmedUrl) {
      onShowToast('Please paste your Moodle iCal Export URL first.', 'warning');
      return;
    }

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      onShowToast(
        'Please enter a valid http/https Moodle iCal Export URL.',
        'warning'
      );
      return;
    }

    if (syncing) return;

    onCloseSettings();
    setSyncing(true);
    try {
      const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(
        trimmedUrl
      )}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Proxy request failed with status ${response.status}`);
      }

      const icsText = await response.text();
      await importAndPersistIcsText(icsText, 'url');
    } catch (err: any) {
      console.warn('Web Moodle iCal sync error:', err);
      onShowToast(
        err?.message || 'Failed to sync Moodle iCal URL via CORS proxy.',
        'warning'
      );
    } finally {
      if (isMountedRef.current) {
        setSyncing(false);
      }
    }
  };

  return (
    <>
      <View style={styles.webInputContainer}>
        <Text style={styles.webInputLabel}>Moodle iCal Export URL</Text>
        <TextInput
          style={styles.webInput}
          value={moodleIcalUrl}
          onChangeText={onChangeMoodleIcalUrl}
          placeholder="Paste your Moodle iCal Export URL..."
          placeholderTextColor="#6B7280"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          selectTextOnFocus
        />
        <TouchableOpacity
          style={styles.webUploadBtn}
          disabled={syncing}
          onPress={handleUploadMoodleIcsFile}
        >
          <Text style={styles.webUploadBtnText}>
            {syncing ? '⏳ Importing .ics...' : '📂 Upload .ics File'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.optionRow}
        disabled={syncing}
        onPress={handleWebMoodleIcalSync}
      >
        <Text style={styles.optionText}>
          {syncing ? '⏳ Syncing Moodle...' : '🎓 Sync Moodle'}
        </Text>
        <Text style={styles.optionChevron}>›</Text>
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  webInputContainer: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  webInputLabel: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  webInput: {
    backgroundColor: '#1F2937',
    color: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  webUploadBtn: {
    marginTop: 8,
    backgroundColor: '#1E3A8A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  webUploadBtnText: {
    color: '#EFF6FF',
    fontSize: 13,
    fontWeight: '700',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  optionText: {
    color: '#F9FAFB',
    fontSize: 15,
    fontWeight: '700',
  },
  optionChevron: {
    color: '#6B7280',
    fontSize: 18,
    fontWeight: '700',
  },
});
