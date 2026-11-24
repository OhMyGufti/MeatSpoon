// index.ts
import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import { initAndroidWidgetTaskHandler } from './src/services/widgetUpdater';
import App from './App';

if (Platform.OS === 'android') {
  initAndroidWidgetTaskHandler();
}

registerRootComponent(App);
