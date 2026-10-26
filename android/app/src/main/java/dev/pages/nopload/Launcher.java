package dev.pages.nopload;

import android.content.Intent;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

// Google's LauncherActivity, which opens the site full screen, plus one thing:
// after a crash, the next launch shows what went wrong (CrashActivity) instead.
public class Launcher extends LauncherActivity {
    private boolean crashed;

    @Override
    protected void onCreate(Bundle state) {
        // Asked for before anything else runs: the report shows even if what
        // follows crashes again.
        crashed = CrashActivity.read(this) != null;
        if (crashed) startActivity(new Intent(this, CrashActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        super.onCreate(state);
        if (crashed) finish();
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return !crashed && super.shouldLaunchImmediately();
    }
}
