package dev.pages.nopload;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

// The app's icon, "Open with", the share sheet and links to the site all start
// here, and go straight to the app's own web view (WebApp.java), which shows
// the launch screen and then the site, never with a browser bar. (Chrome
// shows the site with a bar whenever it hasn't confirmed it belongs to the
// app, so the app doesn't hand it to Chrome at all.) After a crash, the next
// launch shows what went wrong (CrashActivity) instead.
public class Launcher extends Activity {
    static final String HOME = WebApp.ORIGIN + "/?source=android";
    static final String OPEN = WebApp.ORIGIN + "/en/open";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Asked for before anything else runs: the report shows even if what
        // follows crashes again.
        if (CrashActivity.read(this) != null) {
            startActivity(new Intent(this, CrashActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish();
            return;
        }
        startActivity(WebApp.intent(this, Uri.parse(urlFor(getIntent())), getIntent()));
        finish();
        overridePendingTransition(0, 0);
    }

    // A link to the site opens that page; files go to /en/open; else the home page.
    static String urlFor(Intent i) {
        Uri data = i.getData();
        if (Intent.ACTION_VIEW.equals(i.getAction()) && WebApp.isOurs(data)) return data.toString();
        if (Intent.ACTION_VIEW.equals(i.getAction()) && data != null) return OPEN;
        if (Intent.ACTION_SEND.equals(i.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(i.getAction())) return OPEN;
        return HOME;
    }
}
