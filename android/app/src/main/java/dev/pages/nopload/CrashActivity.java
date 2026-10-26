package dev.pages.nopload;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

// What went wrong last time, with Copy and Share, then Open. It runs in its
// own process (see the manifest), so it shows even if opening the site
// crashes again straight away.
public class CrashActivity extends Activity {
    static String read(Context c) {
        File f = new File(c.getFilesDir(), App.CRASH);
        if (!f.exists()) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            String text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String report = read(this);
        //noinspection ResultOfMethodCallIgnored
        new File(getFilesDir(), App.CRASH).delete();
        if (report == null) report = "";
        final String text = report;

        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad * 2, pad, pad);
        root.setFitsSystemWindows(true);

        TextView title = new TextView(this);
        title.setText(R.string.crash_title);
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        TextView body = new TextView(this);
        body.setText(R.string.crash_body);
        body.setPadding(0, pad / 2, 0, pad / 2);
        root.addView(body);

        ScrollView scroll = new ScrollView(this);
        TextView trace = new TextView(this);
        trace.setText(text);
        trace.setTextIsSelectable(true);
        trace.setTypeface(Typeface.MONOSPACE);
        trace.setTextSize(11);
        scroll.addView(trace);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout buttons = new LinearLayout(this);
        Button copy = new Button(this);
        copy.setText(R.string.crash_copy);
        copy.setOnClickListener(v -> {
            ((ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Nopload crash", text));
            Toast.makeText(this, R.string.crash_copied, Toast.LENGTH_SHORT).show();
        });
        Button share = new Button(this);
        share.setText(R.string.crash_share);
        share.setOnClickListener(v -> startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null)));
        Button open = new Button(this);
        open.setText(R.string.crash_open);
        open.setOnClickListener(v -> {
            startActivity(new Intent(this, Launcher.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish();
        });
        LinearLayout.LayoutParams each = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        buttons.addView(copy, each);
        buttons.addView(share, each);
        buttons.addView(open, each);
        root.addView(buttons);
        setContentView(root);
    }
}
