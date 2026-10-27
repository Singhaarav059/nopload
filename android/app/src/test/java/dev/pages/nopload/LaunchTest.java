package dev.pages.nopload;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

// The app opens, as a phone would open it: from its icon, with a PDF from
// "Open with", with a file from the share sheet and from a link to the site,
// always in its own web view, never handed to a browser (which could show a
// browser bar). A crash here is a crash on every phone.
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 28, 33, 34, 35, 36})
public class LaunchTest {
    private final Context c = ApplicationProvider.getApplicationContext();

    // What the launcher starts for `intent`.
    private Intent launch(Intent intent) {
        intent.setComponent(new ComponentName(c, Launcher.class));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Launcher a = Robolectric.buildActivity(Launcher.class, intent).setup().get();
        Intent started = Shadows.shadowOf(a).getNextStartedActivity();
        assertNotNull("nothing launched", started);
        assertTrue("the launcher stays", a.isFinishing());
        return started;
    }

    private void opensInTheWebView(Intent started, String url) {
        assertEquals(WebApp.class.getName(), started.getComponent().getClassName());
        assertEquals(url, started.getStringExtra(WebApp.EXTRA_URL));
        // And the web view really loads it.
        WebApp w = Robolectric.buildActivity(WebApp.class, started).setup().get();
        WebView web = find(w.findViewById(android.R.id.content), WebView.class);
        assertNotNull("no web view", web);
        assertEquals(url, Shadows.shadowOf(web).getLastLoadedUrl());
        assertTrue("the page can't run scripts", web.getSettings().getJavaScriptEnabled());
    }

    @Test
    public void fromTheIcon() {
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        opensInTheWebView(launch(i), "https://nopload.pages.dev/?source=android");
    }

    @Test
    public void openWithPdf() {
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(Uri.parse("content://com.android.providers.downloads.documents/document/1"), "application/pdf");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent started = launch(i);
        assertEquals("the file goes along", "content://com.android.providers.downloads.documents/document/1", String.valueOf(started.getData()));
        opensInTheWebView(started, "https://nopload.pages.dev/en/open");
    }

    @Test
    public void shared() {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("application/pdf");
        i.putExtra(Intent.EXTRA_STREAM, Uri.parse("content://com.whatsapp.provider.media/item/1"));
        Intent started = launch(i);
        assertNotNull("the file goes along", started.getParcelableExtra(Intent.EXTRA_STREAM));
        opensInTheWebView(started, "https://nopload.pages.dev/en/open");
    }

    @Test
    public void aLinkToTheSite() {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://nopload.pages.dev/en/merge-pdf"));
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        opensInTheWebView(launch(i), "https://nopload.pages.dev/en/merge-pdf");
    }

    // Only the site's own pages stay in the app; the rest open in the browser.
    @Test
    public void otherSitesLeave() {
        assertTrue(WebApp.isOurs(Uri.parse("https://nopload.pages.dev/en/merge-pdf")));
        assertFalse(WebApp.isOurs(Uri.parse("https://example.com/")));
        assertFalse(WebApp.isOurs(Uri.parse("http://nopload.pages.dev/")));
        assertFalse(WebApp.isOurs(Uri.parse("https://nopload.pages.dev.example.com/")));
    }

    // Read aloud and printing are stood in for in every page; with no voices
    // yet, the list is empty, not an error.
    @Test
    public void readAloudAndPrint() {
        assertTrue(Native.SCRIPT.contains("speechSynthesis") && Native.SCRIPT.contains("printPdf"));
        assertEquals("[]", new Native(Robolectric.buildActivity(WebApp.class, WebApp.intent(c, Uri.parse(Launcher.HOME), null)).setup().get(), null).voices());
    }

    // After a crash, the next launch shows why (CrashActivity), with Copy,
    // instead of opening the site; Open then opens it.
    @Test
    public void afterACrash() throws Exception {
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(c.getFilesDir(), App.CRASH))) {
            out.write("java.lang.IllegalStateException: test".getBytes());
        }
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        Intent report = launch(i);
        assertEquals(CrashActivity.class.getName(), report.getComponent().getClassName());

        CrashActivity shown = Robolectric.buildActivity(CrashActivity.class, report).setup().get();
        View root = shown.findViewById(android.R.id.content);
        assertTrue("trace not shown", text(root).contains("IllegalStateException: test"));
        assertFalse("report kept", new java.io.File(c.getFilesDir(), App.CRASH).exists());
        button(root, c.getString(R.string.crash_copy)).performClick();
        android.content.ClipboardManager clip = (android.content.ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
        assertTrue(clip.getPrimaryClip().getItemAt(0).getText().toString().contains("test"));
        button(root, c.getString(R.string.crash_open)).performClick();
        Intent again = Shadows.shadowOf(shown).getNextStartedActivity();
        assertEquals(Launcher.class.getName(), again.getComponent().getClassName());
    }

    private static String text(View v) {
        StringBuilder out = new StringBuilder();
        if (v instanceof android.widget.TextView) out.append(((android.widget.TextView) v).getText()).append('\n');
        if (v instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) out.append(text(((ViewGroup) v).getChildAt(i)));
        return out.toString();
    }

    private static View button(View v, String label) {
        if (v instanceof android.widget.Button && label.contentEquals(((android.widget.Button) v).getText())) return v;
        if (v instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) {
            View f = button(((ViewGroup) v).getChildAt(i), label);
            if (f != null) return f;
        }
        return null;
    }

    private static <T extends View> T find(View v, Class<T> type) {
        if (type.isInstance(v)) return type.cast(v);
        if (v instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) {
            T f = find(((ViewGroup) v).getChildAt(i), type);
            if (f != null) return f;
        }
        return null;
    }
}
