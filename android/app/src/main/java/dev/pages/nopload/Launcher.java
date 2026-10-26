package dev.pages.nopload;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.widget.Toast;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

// Google's LauncherActivity, which opens the site full screen, plus one thing:
// after a crash, the next launch shows what went wrong, with Copy, before
// opening the site again.
public class Launcher extends LauncherActivity {
    private String crash() {
        File f = new File(getFilesDir(), App.CRASH);
        if (!f.exists()) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            String text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            return null;
        } finally {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    private String pending;

    @Override
    protected boolean shouldLaunchImmediately() {
        pending = crash();
        if (pending == null) return super.shouldLaunchImmediately();
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
                .setTitle(R.string.crash_title)
                .setMessage(getString(R.string.crash_body) + "\n\n" + pending)
                .setPositiveButton(R.string.crash_copy, (d, w) -> {
                    ClipboardManager clip = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    clip.setPrimaryClip(ClipData.newPlainText("Nopload crash", pending));
                    Toast.makeText(this, R.string.crash_copied, Toast.LENGTH_SHORT).show();
                    launchTwa();
                })
                .setNegativeButton(R.string.crash_open, (d, w) -> launchTwa())
                .setCancelable(false)
                .show();
        return false;
    }
}
