package cafe.aimemory.frame;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import com.getcapacitor.BridgeActivity;

/**
 * 相框 App 的原生外壳。只做三件 Web 端做不到的事：
 *   1. 屏幕永不息屏
 *   2. 真全屏：状态栏（时间/电量/WiFi）和导航栏都收起来
 *   3. 允许页面自动出声（否则浏览器策略会拦住，相框就哑了）
 */
public class MainActivity extends BridgeActivity {

    /** 同一份壳装两个 App：只有相框端需要常亮和全屏 */
    private boolean isFrame() {
        return getPackageName().endsWith(".frame");
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 相框挂在墙上，不能黑屏
        if (isFrame()) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            // 让内容铺到状态栏/导航栏底下。只 hide() 不收边的话，
            // 系统仍然会给状态栏留一条白边——就是平板上那条白带。
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                getWindow().setDecorFitsSystemWindows(false);
            }
            getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
            getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);

            // Capacitor 的 SystemBars 默认会按系统栏高度给 decorView 加 padding。
            // 状态栏隐藏后那一条空白还在，窗口底色是白的——就是平板上那条白带。
            // 直接顶掉它的监听器，不接收任何 inset padding（只对相框包生效）。
            ViewCompat.setOnApplyWindowInsetsListener(
                    getWindow().getDecorView(),
                    (v, insets) -> insets);

            applyImmersive();
        }

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            WebSettings s = webView.getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setDomStorageEnabled(true);
            s.setJavaScriptEnabled(true);
            // 走 https 的服务器时不让 WebView 拦下来
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            if (isFrame()) {
                // WebView 自己的底也刷深色，页面加载前闪一下也不会是白的
                webView.setBackgroundColor(0xFF16120F);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!isFrame()) return;
        applyImmersive();
        // 部分设备启动一两秒后才把状态栏加回来，补一手
        getWindow().getDecorView().postDelayed(this::applyImmersive, 1200);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 用户从边缘划出导航栏后，重新收回去
        if (hasFocus && isFrame()) applyImmersive();
    }

    private void applyImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+：targetSdk 35 起旧 flag 已经失效，必须用 InsetsController
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            View decor = getWindow().getDecorView();
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
    }
}
