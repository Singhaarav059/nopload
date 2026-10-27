package dev.pages.nopload;

import android.content.ComponentName;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.ImageView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaProviderPicker;

// Opens the site full screen in Chrome (Google's LauncherActivity), without
// ever showing a page with a browser bar on top. Chrome shows that bar when it
// hasn't yet confirmed that the site and the app belong together (Digital
// Asset Links: a first launch, a slow network, a Chrome update). So the app
// shows its launch screen and asks Chrome to confirm it first, in the
// background: confirmed, the site opens full screen; not confirmed, no answer
// within a few seconds, or no browser that can show it full screen, it opens
// in the app's own web view (WebApp.java), which has no bar either. Also, after a crash, the next launch shows what went wrong
// (CrashActivity) instead.
public class Launcher extends LauncherActivity {
    // How long Chrome may take to confirm before the site opens in the web view.
    static final long VERIFY_TIMEOUT_MS = 4000;

    private boolean crashed;
    private boolean decided;
    private final Handler main = new Handler(Looper.getMainLooper());
    private CustomTabsServiceConnection connection;

    @Override
    protected void onCreate(Bundle state) {
        // Asked for before anything else runs: the report shows even if what
        // follows crashes again.
        crashed = CrashActivity.read(this) != null;
        if (crashed) startActivity(new Intent(this, CrashActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        super.onCreate(state);
        if (crashed) {
            finish();
            return;
        }
        if (isFinishing()) return;
        showLaunchScreen();
        verifyThenLaunch();
    }

    // Launching waits for the check (verifyThenLaunch).
    @Override
    protected boolean shouldLaunchImmediately() {
        return false;
    }

    // The app's icon on the site's paper colour (ink in dark mode), centred,
    // until the site opens.
    private void showLaunchScreen() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getResources().getColor(dark ? R.color.ink : R.color.paper, getTheme()));
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash);
        int size = (int) (160 * getResources().getDisplayMetrics().density);
        root.addView(logo, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));
        setContentView(root);
    }

    private void verifyThenLaunch() {
        TwaProviderPicker.Action action = TwaProviderPicker.pickProvider(getPackageManager());
        // No browser that can show the site full screen: the app's web view.
        if (action.launchMode != TwaProviderPicker.LaunchMode.TRUSTED_WEB_ACTIVITY || action.provider == null) {
            decide(false);
            return;
        }
        final Uri origin = originOf(getLaunchingUrl());
        connection = new CustomTabsServiceConnection() {
            @Override
            public void onCustomTabsServiceConnected(@NonNull ComponentName name, @NonNull CustomTabsClient client) {
                client.warmup(0);
                CustomTabsSession session = client.newSession(new CustomTabsCallback() {
                    @Override
                    public void onRelationshipValidationResult(int relation, @NonNull Uri requested, boolean result, @Nullable Bundle extras) {
                        main.post(() -> decide(result));
                    }
                });
                if (session == null || !session.validateRelationship(CustomTabsService.RELATION_HANDLE_ALL_URLS, origin, null)) main.post(() -> decide(false));
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                main.post(() -> decide(false));
            }
        };
        boolean bound;
        try {
            bound = CustomTabsClient.bindCustomTabsService(this, action.provider, connection);
        } catch (SecurityException e) {
            bound = false;
        }
        if (!bound) {
            connection = null;
            decide(false);
            return;
        }
        main.postDelayed(() -> decide(false), VERIFY_TIMEOUT_MS);
    }

    // Once: full screen in Chrome when it confirmed, else the web view.
    void decide(boolean verified) {
        if (decided || isFinishing()) return;
        decided = true;
        main.removeCallbacksAndMessages(null);
        if (connection != null) {
            try {
                unbindService(connection);
            } catch (IllegalArgumentException ignored) {
                // Already gone.
            }
            connection = null;
        }
        if (verified) {
            launchTwa();
        } else {
            startActivity(WebApp.intent(this, getLaunchingUrl(), getIntent()));
            finish();
        }
    }

    static Uri originOf(Uri url) {
        return new Uri.Builder().scheme(url.getScheme()).encodedAuthority(url.getEncodedAuthority()).build();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (connection != null) {
            try {
                unbindService(connection);
            } catch (IllegalArgumentException ignored) {
                // Already gone.
            }
            connection = null;
        }
        super.onDestroy();
    }
}
