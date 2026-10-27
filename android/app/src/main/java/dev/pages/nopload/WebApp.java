package dev.pages.nopload;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.graphics.Typeface;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

// The app: the site in its own web view, so there is never a browser bar,
// with the launch screen kept until the first page has drawn. What a browser
// would do for the site, done here: picking files, saving results to
// Downloads, the camera for the scanner, links to other sites in the browser,
// Read aloud's voices and printing (Native.java), and the files Android opens
// or shares with Nopload, handed to /en/open through window.NoploadApp
// (src/components/OpenFiles.tsx).
public class WebApp extends Activity {
    static final String EXTRA_URL = "dev.pages.nopload.URL";
    static final String ORIGIN = "https://nopload.pages.dev";
    private static final int PICK = 1;
    private static final int CAMERA = 2;

    private WebView web;
    private Native features;
    private View splash;
    private ObjectAnimator pulse;
    private FrameLayout root;
    private View offline;
    private int bg;
    private boolean dark;
    private ValueCallback<Uri[]> picking;
    private PermissionRequest asking;
    // Files Android handed over, given to the page once, and whether they
    // were opened with Nopload (one PDF then goes straight to the viewer).
    private final List<Uri> incoming = new ArrayList<>();
    private boolean launched;

    static Intent intent(Context c, Uri url, Intent from) {
        Intent i = new Intent(c, WebApp.class).putExtra(EXTRA_URL, url.toString());
        if (from != null) {
            i.setAction(from.getAction());
            i.setDataAndType(from.getData(), from.getType());
            if (from.getExtras() != null) i.putExtras(from.getExtras());
            i.setClipData(from.getClipData());
            i.addFlags(from.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        return i;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        bg = getResources().getColor(dark ? R.color.ink : R.color.paper, getTheme());
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);

        root = new FrameLayout(this);
        root.setFitsSystemWindows(true);
        root.setBackgroundColor(bg);
        web = new WebView(this);
        web.setBackgroundColor(bg);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        FrameLayout cover = new FrameLayout(this);
        cover.setBackgroundColor(bg);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash);
        int size = (int) (160 * getResources().getDisplayMetrics().density);
        cover.addView(logo, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));
        root.addView(cover, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        splash = cover;
        // The logo breathes while the site loads.
        pulse = ObjectAnimator.ofPropertyValuesHolder(logo, PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 0.92f), PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 0.92f), PropertyValuesHolder.ofFloat(View.ALPHA, 1f, 0.75f));
        pulse.setDuration(900);
        pulse.setRepeatMode(ValueAnimator.REVERSE);
        pulse.setRepeatCount(ValueAnimator.INFINITE);
        pulse.start();
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " NoploadApp/" + BuildConfig.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(), "NoploadApp");
        features = new Native(this, web);
        features.start();
        web.addJavascriptInterface(features, "NoploadNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (isOurs(u)) return false;
                openOutside(u);
                return true;
            }

            // The site can't be reached (offline before it was ever opened, the
            // network down): the app's own screen, with Try again, instead of
            // the web view's error page.
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                view.evaluateJavascript(Native.SCRIPT, null);
                hideSplash();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(Native.SCRIPT, null);
                hideSplash();
                // Saving: remember the name a download link asks for, since
                // the web view hands over only the blob: address.
                view.evaluateJavascript("(()=>{if(window.__noploadSave)return;window.__noploadSave=1;const c=HTMLAnchorElement.prototype.click;"
                        + "HTMLAnchorElement.prototype.click=function(){if(this.download)window.__noploadName=this.download;return c.apply(this,arguments)};"
                        + "document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[download]');if(a)window.__noploadName=a.download},true)})()", null);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picking != null) picking.onReceiveValue(null);
                picking = callback;
                Intent pick = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(pick, PICK);
                } catch (ActivityNotFoundException e) {
                    picking = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (!isOurs(request.getOrigin())) {
                    request.deny();
                    return;
                }
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        asking = request;
                        requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA);
                        return;
                    }
                }
                request.grant(request.getResources());
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> save(url, mime));

        take(getIntent());
        String url = getIntent().getStringExtra(EXTRA_URL);
        if (state != null) web.restoreState(state);
        else web.loadUrl(!incoming.isEmpty() ? ORIGIN + "/en/open" : url != null ? url : ORIGIN + "/?source=android");
    }

    // Opened again with other files while running: they go to /en/open.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        take(intent);
        if (!incoming.isEmpty()) web.loadUrl(ORIGIN + "/en/open");
    }

    private void take(Intent i) {
        incoming.clear();
        String action = i.getAction();
        launched = Intent.ACTION_VIEW.equals(action);
        if (Intent.ACTION_VIEW.equals(action) && i.getData() != null && "content".equals(i.getData().getScheme())) incoming.add(i.getData());
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ClipData clip = i.getClipData();
            if (clip != null) for (int k = 0; k < clip.getItemCount(); k++) if (clip.getItemAt(k).getUri() != null) incoming.add(clip.getItemAt(k).getUri());
            if (incoming.isEmpty()) {
                Uri one = i.getParcelableExtra(Intent.EXTRA_STREAM);
                if (one != null) incoming.add(one);
            }
        }
    }

    static boolean isOurs(Uri u) {
        return u != null && "https".equals(u.getScheme()) && "nopload.pages.dev".equals(u.getHost());
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignored) {
            // Nothing can open it.
        }
    }

    private void showOffline() {
        if (offline != null) return;
        if (pulse != null) pulse.cancel();
        int pad = (int) (28 * getResources().getDisplayMetrics().density);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(pad, pad, pad, pad);
        box.setBackgroundColor(bg);
        box.setClickable(true);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash);
        int size = (int) (96 * getResources().getDisplayMetrics().density);
        box.addView(logo, new LinearLayout.LayoutParams(size, size));
        int ink = getResources().getColor(dark ? R.color.paper : R.color.ink, getTheme());
        TextView title = new TextView(this);
        title.setText(R.string.offline_title);
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(ink);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, pad / 2, 0, pad / 4);
        box.addView(title);
        TextView body = new TextView(this);
        body.setText(R.string.offline_body);
        body.setTextSize(15);
        body.setTextColor(ink);
        body.setAlpha(0.72f);
        body.setGravity(Gravity.CENTER);
        box.addView(body);
        Button retry = new Button(this);
        retry.setText(R.string.offline_retry);
        retry.setOnClickListener(v -> {
            root.removeView(box);
            offline = null;
            web.reload();
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = pad / 2;
        box.addView(retry, lp);
        root.addView(box, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        offline = box;
        if (splash != null) {
            root.removeView(splash);
            splash = null;
        }
    }

    private void hideSplash() {
        if (offline != null) return;
        if (splash == null) return;
        if (pulse != null) pulse.cancel();
        View s = splash;
        splash = null;
        s.animate().alpha(0).setDuration(250).withEndAction(() -> ((FrameLayout) s.getParent()).removeView(s)).start();
    }

    // A result the page saves: a blob: or data: address is read by the page
    // and handed over as base64 (Bridge.save); anything else is fetched by
    // Android's download manager.
    private void save(String url, String mime) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            String js = "(async(u)=>{try{const b=await (await fetch(u)).blob();const r=new FileReader();"
                    + "r.onload=()=>NoploadApp.save(window.__noploadName||'',b.type||" + JSONObject.quote(mime == null ? "" : mime) + ",String(r.result).split(',')[1]||'');r.readAsDataURL(b)}"
                    + "catch(e){NoploadApp.save('','','')}})(" + JSONObject.quote(url) + ")";
            web.evaluateJavascript(js, null);
        } else {
            openOutside(Uri.parse(url));
        }
    }

    private void saved(String asked, String type, byte[] bytes) {
        final String name = asked.isEmpty() ? "nopload-" + System.currentTimeMillis() : asked;
        final String mime = type.isEmpty() ? "application/octet-stream" : type;
        try {
            Uri out;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Nopload");
                out = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (out == null) throw new IllegalStateException("no Downloads");
                try (OutputStream o = getContentResolver().openOutputStream(out)) {
                    if (o == null) throw new IllegalStateException("can't write");
                    o.write(bytes);
                }
            } else {
                // Before Android 10, the app's own folder, opened from there.
                File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream o = new FileOutputStream(f)) {
                    o.write(bytes);
                }
                out = FileProvider.getUriForFile(this, "dev.pages.nopload.fileprovider", f);
            }
            Toast.makeText(this, getString(R.string.saved, name), Toast.LENGTH_LONG).show();
            final Uri open = out;
            web.postDelayed(() -> {
                try {
                    startActivity(Intent.createChooser(new Intent(Intent.ACTION_VIEW).setDataAndType(open, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), name));
                } catch (ActivityNotFoundException ignored) {
                    // Saved; nothing to open it with.
                }
            }, 400);
        } catch (Exception e) {
            Toast.makeText(this, R.string.save_failed, Toast.LENGTH_LONG).show();
        }
    }

    // What the page can ask of the app (only pages of the site are ever shown).
    class Bridge {
        // The files Android handed over, once: { launched, files: [{ name, type, data }] }.
        @JavascriptInterface
        public String takeFiles() {
            JSONObject out = new JSONObject();
            JSONArray files = new JSONArray();
            try {
                for (Uri u : incoming) {
                    try (InputStream in = getContentResolver().openInputStream(u)) {
                        if (in == null) continue;
                        ByteArrayOutputStream buf = new ByteArrayOutputStream();
                        byte[] b = new byte[65536];
                        for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
                        files.put(new JSONObject().put("name", nameOf(u)).put("type", String.valueOf(getContentResolver().getType(u))).put("data", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP)));
                    } catch (Exception ignored) {
                        // Unreadable: left out.
                    }
                }
                out.put("launched", launched).put("files", files);
            } catch (Exception ignored) {
                // An empty answer.
            }
            incoming.clear();
            return out.toString();
        }

        @JavascriptInterface
        public void save(String name, String mime, String base64) {
            final byte[] bytes = base64.isEmpty() ? null : Base64.decode(base64, Base64.DEFAULT);
            runOnUiThread(() -> {
                if (bytes == null) Toast.makeText(WebApp.this, R.string.save_failed, Toast.LENGTH_LONG).show();
                else saved(name, mime, bytes);
            });
        }
    }

    private String nameOf(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
            // Fall back to the address.
        }
        String last = u.getLastPathSegment();
        return last != null ? last : "file";
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK || picking == null) return;
        Uri[] picked = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                picked = new Uri[data.getClipData().getItemCount()];
                for (int k = 0; k < picked.length; k++) picked[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data.getData() != null) picked = new Uri[] {data.getData()};
        }
        picking.onReceiveValue(picked);
        picking = null;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request != CAMERA || asking == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) asking.grant(asking.getResources());
        else asking.deny();
        asking = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        features.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
