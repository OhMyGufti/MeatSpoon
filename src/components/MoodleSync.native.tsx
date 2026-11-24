import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  WebView,
  WebViewMessageEvent,
  WebViewNavigation,
} from 'react-native-webview';
import {
  MOODLE_BG_INJECTED_SYNC_SCRIPT,
  MOODLE_CALENDAR_EXPORT_URL,
  MOODLE_INJECTED_SYNC_SCRIPT,
  MOODLE_LOGIN_URL,
  PersistedStateSnapshot,
  isMoodleAuthenticatedUrl,
  isMoodleLoginRedirectUrl,
  parseMoodleSyncPayload,
  persistMoodleTasksToStorage,
} from '../services/moodleSync';
import { MoodleSyncProps } from './MoodleSync.types';
import { useMenuBackHandler } from '../hooks/useMenuBackHandler';

/**
 * Native (Android / iOS APK) Moodle Sync component.
 * Uses an in-app `react-native-webview` modal for interactive Technion SSO login +
 * automated calendar extraction, plus a hidden 0x0 background WebView on mount.
 * Formats, merges, and persists tasks to AsyncStorage identically to MoodleSync.web.tsx.
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
  isHydratingStorage,
  modalVisible,
  onChangeModalVisible,
  onCloseSettings,
  onTasksSynced,
  onShowToast,
}: MoodleSyncProps) {
  const [moodleCurrentUrl, setMoodleCurrentUrl] = useState(MOODLE_LOGIN_URL);
  const [moodleSyncing, setMoodleSyncing] = useState(false);
  const moodleWebViewRef = useRef<WebView<{}> | null>(null);

  const autoOpenMoodleLoginRef = useRef<boolean>(autoOpenMoodleLogin);
  autoOpenMoodleLoginRef.current = autoOpenMoodleLogin;

  const [bgMoodleSyncActive, setBgMoodleSyncActive] = useState(true);
  const bgMoodleWebViewRef = useRef<WebView<{}> | null>(null);
  const bgMoodleHandledRef = useRef(false);

  useMenuBackHandler(mode === 'runtime' && modalVisible, () =>
    onChangeModalVisible(false)
  );

  useEffect(() => {
    if (modalVisible) {
      setMoodleSyncing(false);
      setMoodleCurrentUrl(MOODLE_LOGIN_URL);
    }
  }, [modalVisible]);

  if (mode === 'settings') {
    return (
      <TouchableOpacity
        style={styles.optionRow}
        onPress={() => {
          onCloseSettings();
          onChangeModalVisible(true);
        }}
      >
        <Text style={styles.optionText}>🎓 Sync Moodle</Text>
        <Text style={styles.optionChevron}>›</Text>
      </TouchableOpacity>
    );
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

  const persistAndMergeMoodlePayload = async (
    rawData: string
  ): Promise<{ totalCount: number; newlyAddedCount: number }> => {
    const syncedTasks = parseMoodleSyncPayload(rawData, events, catalog);
    if (syncedTasks.length === 0) {
      return { totalCount: 0, newlyAddedCount: 0 };
    }

    const { newlyAddedCount, updatedDismissedIds } =
      await persistMoodleTasksToStorage(
        syncedTasks,
        buildStateSnapshot(),
        isHydratingStorage
      );
    onTasksSynced(syncedTasks, updatedDismissedIds);

    return {
      totalCount: syncedTasks.length,
      newlyAddedCount,
    };
  };

  // Interactive WebView Moodle Task Sync Handlers
  const handleMoodleNavigationStateChange = (navState: WebViewNavigation) => {
    const url = navState.url || '';
    setMoodleCurrentUrl(url);

    // If the user is on a login or SSO URL, keep the WebView interactive and do not extract
    if (isMoodleLoginRedirectUrl(url)) {
      setMoodleSyncing(false);
      return;
    }

    if (!navState.loading && isMoodleAuthenticatedUrl(url)) {
      moodleWebViewRef.current?.injectJavaScript(MOODLE_INJECTED_SYNC_SCRIPT);
    }
  };

  const handleMoodleWebViewMessage = async (event: WebViewMessageEvent) => {
    const rawData = event.nativeEvent.data;
    if (!rawData) return;

    let parsedMsg: any = null;
    try {
      parsedMsg = JSON.parse(rawData);
    } catch {
      parsedMsg = null;
    }

    // Ignore or reset syncing state if the user is not yet logged in on the current page
    if (!parsedMsg || parsedMsg.type === 'MOODLE_NOT_LOGGED_IN') {
      setMoodleSyncing(false);
      return;
    }

    if (parsedMsg.type === 'MOODLE_MANUAL_SYNC_NOT_LOGGED_IN') {
      setMoodleSyncing(false);
      Alert.alert(
        'Login Required',
        'Please sign in to your Technion Moodle account first, then tap "Sync Now".'
      );
      return;
    }

    if (parsedMsg.type === 'MOODLE_SYNC_STARTED') {
      setMoodleSyncing(true);
      return;
    }

    setMoodleSyncing(false);

    if (parsedMsg.type === 'MOODLE_SYNC_ERROR') {
      Alert.alert(
        'Moodle Sync Error',
        parsedMsg.message || 'Could not fetch Moodle calendar tasks.'
      );
      return;
    }

    if (parsedMsg.type !== 'MOODLE_CALENDAR_DATA') {
      return;
    }

    onChangeModalVisible(false);

    const { totalCount, newlyAddedCount } =
      await persistAndMergeMoodlePayload(rawData);

    if (totalCount === 0) {
      Alert.alert(
        'Moodle Sync Complete',
        '0 upcoming tasks were found in your Technion Moodle calendar.'
      );
      return;
    }

    Alert.alert(
      '🎓 Moodle Sync Successful',
      `Synced ${totalCount} assignment(s) from Moodle (${newlyAddedCount} new added to your local schedule).`
    );
  };

  // Silent Background Moodle Sync Handlers (runs on mount without blocking UI)
  const triggerBgMoodleExpiredNotice = () => {
    if (bgMoodleHandledRef.current) return;
    bgMoodleHandledRef.current = true;
    setBgMoodleSyncActive(false);

    if (autoOpenMoodleLoginRef.current) {
      // Automatically open the Moodle WebView modal so the user can authenticate via native OS Password Manager
      onChangeModalVisible(true);
    } else {
      onShowToast(
        'פג תוקף החיבור למודל. יש להתחבר מחדש דרך ההגדרות.',
        'warning'
      );
    }
  };

  const handleBgMoodleNavigationStateChange = (navState: WebViewNavigation) => {
    if (bgMoodleHandledRef.current) return;
    const url = navState.url || '';
    if (!url) return;

    // Detect redirect to Moodle login page or SSO (session cookie expired)
    if (isMoodleLoginRedirectUrl(url)) {
      triggerBgMoodleExpiredNotice();
      return;
    }

    if (!navState.loading) {
      bgMoodleWebViewRef.current?.injectJavaScript(
        MOODLE_BG_INJECTED_SYNC_SCRIPT
      );
    }
  };

  const handleBgMoodleMessage = async (event: WebViewMessageEvent) => {
    if (bgMoodleHandledRef.current) return;
    const rawData = event.nativeEvent.data;
    if (!rawData) return;

    let parsedMsg: any = null;
    try {
      parsedMsg = JSON.parse(rawData);
    } catch {
      parsedMsg = null;
    }

    if (
      !parsedMsg ||
      parsedMsg.type === 'MOODLE_BG_AUTH_EXPIRED' ||
      parsedMsg.type === 'MOODLE_SYNC_ERROR'
    ) {
      triggerBgMoodleExpiredNotice();
      return;
    }

    bgMoodleHandledRef.current = true;
    setBgMoodleSyncActive(false);

    await persistAndMergeMoodlePayload(rawData);
    onShowToast('המטלות סונכרנו בהצלחה', 'success');
  };

  return (
    <>
      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => onChangeModalVisible(false)}
      >
        <SafeAreaProvider>
          <SafeAreaView
            style={styles.moodleModalContainer}
            edges={['top', 'left', 'right', 'bottom']}
          >
            <View style={styles.moodleHeader}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.moodleHeaderTitle}>
                  🎓 Technion Moodle Task Sync
                </Text>
                <Text style={styles.moodleHeaderSub} numberOfLines={1}>
                  {moodleSyncing
                    ? 'Extracting upcoming assignments from Moodle calendar...'
                    : moodleCurrentUrl}
                </Text>
              </View>

              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#0284C7' }]}
                  onPress={() => {
                    moodleWebViewRef.current?.injectJavaScript(`
                      window.__meatSpoonManualMoodleSync = true;
                      window.__meatSpoonMoodleSyncRunning = false;
                      ${MOODLE_INJECTED_SYNC_SCRIPT}
                    `);
                  }}
                >
                  <Text style={styles.btnText}>Sync Now</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => onChangeModalVisible(false)}>
                  <Text style={styles.closeText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>

            {moodleSyncing && (
              <View style={styles.moodleSyncBanner}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.moodleSyncBannerText}>
                  Logged in! Fetching Moodle calendar tasks...
                </Text>
              </View>
            )}

            <WebView<{}>
              ref={moodleWebViewRef}
              source={{ uri: MOODLE_LOGIN_URL }}
              style={{ flex: 1 }}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              cacheEnabled
              incognito={false}
              saveFormDataDisabled={false}
              keyboardDisplayRequiresUserAction={false}
              injectedJavaScript={MOODLE_INJECTED_SYNC_SCRIPT}
              onNavigationStateChange={handleMoodleNavigationStateChange}
              onMessage={handleMoodleWebViewMessage}
            />
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      {!isHydratingStorage && bgMoodleSyncActive && !modalVisible && (
        <View style={styles.hiddenBgWebViewContainer} pointerEvents="none">
          <WebView<{}>
            ref={bgMoodleWebViewRef}
            source={{ uri: MOODLE_CALENDAR_EXPORT_URL }}
            style={{ width: 0, height: 0, opacity: 0 }}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            injectedJavaScript={MOODLE_BG_INJECTED_SYNC_SCRIPT}
            onNavigationStateChange={handleBgMoodleNavigationStateChange}
            onMessage={handleBgMoodleMessage}
            onError={triggerBgMoodleExpiredNotice}
            onHttpError={triggerBgMoodleExpiredNotice}
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
  moodleModalContainer: {
    flex: 1,
    backgroundColor: '#111827',
  },
  moodleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  moodleHeaderTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '700',
  },
  moodleHeaderSub: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2,
  },
  moodleSyncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0284C7',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  moodleSyncBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  btn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
  },
  closeText: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '600',
  },
  hiddenBgWebViewContainer: {
    position: 'absolute',
    width: 0,
    height: 0,
    left: -9999,
    top: -9999,
    opacity: 0,
    overflow: 'hidden',
  },
});
