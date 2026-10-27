package dev.pages.nopload;

import static org.junit.Assert.assertNotNull;

import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.net.Uri;

import androidx.test.core.app.ApplicationProvider;


import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowPackageManager;
import org.robolectric.shadows.ShadowLooper;

import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.customtabs.CustomTabsSessionToken;
import java.util.List;

// The app opens, as a phone would open it: from its icon, with a PDF from
// "Open with", and with a file from the share sheet. A crash here is a crash
// on every phone.
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 28, 33, 34, 35, 36})
public class LaunchTest {
    // Chrome's side of the connection: accepts everything, as Chrome does, and
    // answers the app's check that the site is its own with `verified` (null:
    // no answer, as when Chrome can't reach the site).
    public static class FakeChrome extends CustomTabsService {
        static Boolean verified = true;
        @Override protected boolean warmup(long flags) { return true; }
        @Override protected boolean newSession(@NonNull CustomTabsSessionToken s) { return true; }
        @Override protected boolean mayLaunchUrl(@NonNull CustomTabsSessionToken s, @Nullable Uri u, @Nullable Bundle b, @Nullable List<Bundle> o) { return true; }
        @Nullable @Override protected Bundle extraCommand(@NonNull String c, @Nullable Bundle b) { return null; }
        @Override protected boolean updateVisuals(@NonNull CustomTabsSessionToken s, @Nullable Bundle b) { return true; }
        @Override protected boolean requestPostMessageChannel(@NonNull CustomTabsSessionToken s, @NonNull Uri u) { return true; }
        @Override protected int postMessage(@NonNull CustomTabsSessionToken s, @NonNull String m, @Nullable Bundle b) { return 0; }
        @Override protected boolean validateRelationship(@NonNull CustomTabsSessionToken s, int r, @NonNull Uri o, @Nullable Bundle b) {
            if (verified != null && s.getCallback() != null) s.getCallback().onRelationshipValidationResult(r, o, verified, null);
            return true;
        }
        @Override protected boolean receiveFile(@NonNull CustomTabsSessionToken s, @NonNull Uri u, int p, @Nullable Bundle b) { return true; }
    }

    // An installed browser, signed as every installed app is.
    static void install(String pkg, String main) {
        ShadowPackageManager pm = Shadows.shadowOf(ApplicationProvider.getApplicationContext().getPackageManager());
        android.content.pm.PackageInfo info = new android.content.pm.PackageInfo();
        info.packageName = pkg;
        info.versionName = "130.0.6723.0";
        info.applicationInfo = new android.content.pm.ApplicationInfo();
        info.applicationInfo.packageName = info.packageName;
        android.content.pm.Signature sig = new android.content.pm.Signature(new byte[] {1, 2, 3, 4});
        info.signatures = new android.content.pm.Signature[] {sig};
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            info.signingInfo = new android.content.pm.SigningInfo();
            Shadows.shadowOf(info.signingInfo).setSignatures(new android.content.pm.Signature[] {sig});
        }
        pm.installPackage(info);
        ComponentName browser = new ComponentName(pkg, main);
        pm.addActivityIfNotPresent(browser);
        IntentFilter view = new IntentFilter(Intent.ACTION_VIEW);
        view.addCategory(Intent.CATEGORY_BROWSABLE);
        view.addCategory(Intent.CATEGORY_DEFAULT);
        view.addDataScheme("https");
        view.addDataScheme("http");
        try {
            pm.addIntentFilterForActivity(browser, view);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // A browser that can show the site full screen, as Chrome on a phone.
    @Before
    public void chrome() {
        org.robolectric.shadows.ShadowLog.stream = System.out;
        FakeChrome.verified = true;
        install("com.android.chrome", "com.google.android.apps.chrome.Main");
        ShadowPackageManager pm = Shadows.shadowOf(ApplicationProvider.getApplicationContext().getPackageManager());
        ComponentName service = new ComponentName("com.android.chrome", "org.chromium.chrome.browser.customtabs.CustomTabsConnectionService");
        pm.addServiceIfNotPresent(service);
        IntentFilter tabs = new IntentFilter("android.support.customtabs.action.CustomTabsService");
        tabs.addCategory("androidx.browser.trusted.category.TrustedWebActivities");
        pm.addIntentFilterForService(service, tabs);
        FakeChrome fake = Robolectric.setupService(FakeChrome.class);
        Shadows.shadowOf((android.app.Application) ApplicationProvider.getApplicationContext())
                .setComponentNameAndServiceForBindServiceForIntent(new Intent("android.support.customtabs.action.CustomTabsService").setPackage("com.android.chrome"), service, fake.onBind(new Intent()));
    }

    private void forgetChrome() {
        Shadows.shadowOf(ApplicationProvider.getApplicationContext().getPackageManager()).deletePackage("com.android.chrome");
    }

    // A phone whose only browser can't show sites full screen: the app shows
    // the site itself rather than closing.
    @Test
    public void withAnotherBrowser() {
        forgetChrome();
        install("org.example.browser", "org.example.browser.Main");
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        open(i);
    }

    // No browser at all: the app shows the site itself.
    @Test
    public void withNoBrowser() {
        forgetChrome();
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        open(i);
    }

    // Every activity the library turns on or opens is declared: a missing one
    // crashes every launch on a phone (Android refuses to enable it), which the
    // test package manager doesn't.
    @Test
    public void everyLibraryActivityIsDeclared() throws Exception {
        android.content.Context c = ApplicationProvider.getApplicationContext();
        android.content.pm.PackageManager pm = c.getPackageManager();
        for (String name : new String[] {
                "com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity",
                "com.google.androidbrowserhelper.trusted.FocusActivity",
                "com.google.androidbrowserhelper.trusted.WebViewFallbackActivity",
                "com.google.androidbrowserhelper.trusted.ShortcutTrampolineActivity",
                "com.google.androidbrowserhelper.trusted.ColdShortcutActivity"}) {
            pm.getActivityInfo(new ComponentName(c, name), 0);
        }
        android.content.pm.ActivityInfo manage = pm.getActivityInfo(new ComponentName(c, "com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity"), android.content.pm.PackageManager.GET_META_DATA);
        org.junit.Assert.assertEquals("https://nopload.pages.dev/?source=android", manage.metaData.getString("android.support.customtabs.trusted.MANAGE_SPACE_URL"));
        org.junit.Assert.assertEquals("com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity", c.getApplicationInfo().manageSpaceActivityName);
    }

    // After a crash, the next launch shows why (CrashActivity), with Copy,
    // instead of opening the site; Open then opens it.
    @Test
    public void afterACrash() throws Exception {
        android.content.Context c = ApplicationProvider.getApplicationContext();
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(c.getFilesDir(), App.CRASH))) {
            out.write("java.lang.IllegalStateException: test".getBytes());
        }
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        i.setComponent(new ComponentName(c, Launcher.class));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Launcher a = started(Robolectric.buildActivity(Launcher.class, i).setup()).get();
        Intent report = Shadows.shadowOf(a).getNextStartedActivity();
        assertNotNull("no report shown", report);
        org.junit.Assert.assertEquals(CrashActivity.class.getName(), report.getComponent().getClassName());
        org.junit.Assert.assertTrue("the site opened anyway", a.isFinishing());

        CrashActivity shown = Robolectric.buildActivity(CrashActivity.class, report).setup().get();
        android.view.View root = shown.findViewById(android.R.id.content);
        org.junit.Assert.assertTrue("trace not shown", text(root).contains("IllegalStateException: test"));
        org.junit.Assert.assertFalse("report kept", new java.io.File(c.getFilesDir(), App.CRASH).exists());
        find(root, c.getString(R.string.crash_copy)).performClick();
        android.content.ClipboardManager clip = (android.content.ClipboardManager) c.getSystemService(android.content.Context.CLIPBOARD_SERVICE);
        org.junit.Assert.assertTrue(clip.getPrimaryClip().getItemAt(0).getText().toString().contains("test"));
        find(root, c.getString(R.string.crash_open)).performClick();
        Intent again = Shadows.shadowOf(shown).getNextStartedActivity();
        org.junit.Assert.assertEquals(Launcher.class.getName(), again.getComponent().getClassName());
    }

    private static String text(android.view.View v) {
        StringBuilder out = new StringBuilder();
        if (v instanceof android.widget.TextView) out.append(((android.widget.TextView) v).getText()).append('\n');
        if (v instanceof android.view.ViewGroup) for (int i = 0; i < ((android.view.ViewGroup) v).getChildCount(); i++) out.append(text(((android.view.ViewGroup) v).getChildAt(i)));
        return out.toString();
    }

    private static android.view.View find(android.view.View v, String label) {
        if (v instanceof android.widget.Button && label.contentEquals(((android.widget.Button) v).getText())) return v;
        if (v instanceof android.view.ViewGroup) for (int i = 0; i < ((android.view.ViewGroup) v).getChildCount(); i++) {
            android.view.View f = find(((android.view.ViewGroup) v).getChildAt(i), label);
            if (f != null) return f;
        }
        return null;
    }

    // The library counts the launchers alive (a second one means the app is
    // already open), so each test closes its own afterwards.
    private final List<org.robolectric.android.controller.ActivityController<Launcher>> alive = new java.util.ArrayList<>();

    private org.robolectric.android.controller.ActivityController<Launcher> started(org.robolectric.android.controller.ActivityController<Launcher> c) {
        alive.add(c);
        return c;
    }

    @org.junit.After
    public void close() {
        for (org.robolectric.android.controller.ActivityController<Launcher> c : alive) c.pause().stop().destroy();
    }

    private Intent open(Intent intent) {
        intent.setComponent(new ComponentName(ApplicationProvider.getApplicationContext(), Launcher.class));
        // As Android starts it from the home screen or another app: in its own task.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Launcher a = started(Robolectric.buildActivity(Launcher.class, intent).setup()).get();
        assertNotNull(a);
        // The splash waits for the opening animation, which a phone reports and a test doesn't.
        a.onEnterAnimationComplete();
        // The launch screen shows while Chrome is asked.
        org.junit.Assert.assertNotNull("no launch screen", a.findViewById(android.R.id.content));
        // Let the connection to Chrome come up and the launch go through.
        for (int i = 0; i < 20; i++) {
            ShadowLooper.idleMainLooper();
            ShadowLooper.runUiThreadTasksIncludingDelayedTasks();
        }
        Intent started = Shadows.shadowOf(a).getNextStartedActivity();
        // The first is this activity's own start; the next is the hand-off to Chrome.
        if (started != null && started.getComponent() != null && started.getComponent().getClassName().equals(Launcher.class.getName())) started = Shadows.shadowOf(a).getNextStartedActivity();
        if (started == null) started = Shadows.shadowOf((android.app.Application) ApplicationProvider.getApplicationContext()).getNextStartedActivity();
        System.out.println("LAUNCHED " + intent.getAction() + " -> " + (started == null ? "nothing" : started + " " + started.getData() + " pkg=" + started.getPackage()));
        assertNotNull("nothing launched", started);
        return started;
    }

    private static boolean isWebView(Intent started) {
        return started.getComponent() != null && started.getComponent().getClassName().equals(WebApp.class.getName());
    }

    // Chrome confirms the site is the app's own: it opens full screen in
    // Chrome, never with a bar, and the app's launch screen shows meanwhile.
    @Test
    public void verifiedOpensInChrome() {
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        Intent started = open(i);
        org.junit.Assert.assertFalse("opened in the web view", isWebView(started));
        org.junit.Assert.assertEquals("com.android.chrome", started.getPackage());
    }

    // Chrome can't confirm it (it would show the site with a browser bar): the
    // site opens in the app's own web view instead, with no bar.
    @Test
    public void unverifiedOpensInTheWebView() {
        FakeChrome.verified = false;
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        Intent started = open(i);
        org.junit.Assert.assertTrue("not the web view: " + started, isWebView(started));
        org.junit.Assert.assertEquals("https://nopload.pages.dev/?source=android", extraUri(started));
    }

    // Chrome doesn't answer (offline, slow): after a few seconds, the web view.
    @Test
    public void noAnswerOpensInTheWebView() {
        FakeChrome.verified = null;
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        Intent started = open(i);
        org.junit.Assert.assertTrue("not the web view: " + started, isWebView(started));
    }

    private static String extraUri(Intent i) {
        Bundle b = i.getExtras();
        if (b == null) return "null";
        if (b.containsKey(WebApp.EXTRA_URL)) return b.getString(WebApp.EXTRA_URL);
        return b.toString();
    }

    // The web view opens the site, from the icon and with a PDF from "Open
    // with", which goes to /en/open; links to other sites leave the app.
    @Test
    public void webViewOpens() {
        android.content.Context c = ApplicationProvider.getApplicationContext();
        WebApp a = Robolectric.buildActivity(WebApp.class, WebApp.intent(c, Uri.parse("https://nopload.pages.dev/?source=android"), null)).setup().get();
        android.webkit.WebView web = find(a.findViewById(android.R.id.content), android.webkit.WebView.class);
        assertNotNull("no web view", web);
        org.junit.Assert.assertEquals("https://nopload.pages.dev/?source=android", Shadows.shadowOf(web).getLastLoadedUrl());

        Intent pdf = new Intent(Intent.ACTION_VIEW);
        pdf.setDataAndType(Uri.parse("content://com.android.providers.downloads.documents/document/1"), "application/pdf");
        WebApp b = Robolectric.buildActivity(WebApp.class, WebApp.intent(c, Uri.parse("https://nopload.pages.dev/en/open"), pdf)).setup().get();
        org.junit.Assert.assertEquals("https://nopload.pages.dev/en/open", Shadows.shadowOf(find(b.findViewById(android.R.id.content), android.webkit.WebView.class)).getLastLoadedUrl());

        org.junit.Assert.assertTrue(WebApp.isOurs(Uri.parse("https://nopload.pages.dev/en/merge-pdf")));
        org.junit.Assert.assertFalse(WebApp.isOurs(Uri.parse("https://example.com/")));
        org.junit.Assert.assertFalse(WebApp.isOurs(Uri.parse("http://nopload.pages.dev/")));
    }

    private static <T extends android.view.View> T find(android.view.View v, Class<T> type) {
        if (type.isInstance(v)) return type.cast(v);
        if (v instanceof android.view.ViewGroup) for (int i = 0; i < ((android.view.ViewGroup) v).getChildCount(); i++) {
            T f = find(((android.view.ViewGroup) v).getChildAt(i), type);
            if (f != null) return f;
        }
        return null;
    }

    @Test
    public void fromTheIcon() {
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        open(i);
    }

    @Test
    public void openWithPdf() {
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(Uri.parse("content://com.android.providers.downloads.documents/document/1"), "application/pdf");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        open(i);
    }

    @Test
    public void shared() {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("application/pdf");
        i.putExtra(Intent.EXTRA_STREAM, Uri.parse("content://com.whatsapp.provider.media/item/1"));
        open(i);
    }
}
