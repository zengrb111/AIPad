import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cafe.aimemory.frame',
  appName: '相框',
  webDir: 'dist',
  backgroundColor: '#16120f',
  android: {
    // 服务多半是局域网 http，WebView 要放行
    allowMixedContent: true,
    backgroundColor: '#16120f',
    webContentsDebuggingEnabled: true,
  },
  ios: {
    backgroundColor: '#16120f',
    contentInset: 'never',
  },
  server: {
    // 页面用 http://localhost 加载：既能调 http 接口，
    // 又满足浏览器对麦克风要求的「安全来源」（localhost 算安全）
    androidScheme: 'http',
    cleartext: true,
  },
}

export default config
