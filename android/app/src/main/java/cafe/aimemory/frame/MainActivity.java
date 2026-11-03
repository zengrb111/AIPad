package cafe.aimemory.frame;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * 相框 App 的原生外壳。只做三件 Web 端做不到的事：
 *   1. 屏幕永不息屏
 *   2. 状态栏 / 导航栏收起来
 *   3. 允许页面自动出声（否则浏览器策略会拦住，相框就哑了）
 *
 * 这里不要再碰 decorView 的 padding，也不要 setDecorFitsSystemWindows——
 * 之前为去掉顶部留白改过一轮，把页面搞成白屏了。
 * 留白现在靠主题的深色窗口底色兜住：就算还剩一条，也是黑的，看不出来。
 */
public class MainActivity extends BridgeActivity {

    /** 同一份壳装两个 App：只有相框端需要常亮和全屏 */
    private boolean isFrame() {
        return getPackageName().endsWith(".frame");
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (isFrame()) {
            // 相框挂在墙上，不能黑屏
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
            getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
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
                // 页面加载前闪一下也不会是白的
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
            // Android 11+：新的 InsetsController（旧 flag 在新系统上会被忽略）
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }

        // 老系统兜底（放在新 API 后面，避免互相打架）
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
    }
}
