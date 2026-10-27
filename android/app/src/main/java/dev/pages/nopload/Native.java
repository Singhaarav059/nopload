package dev.pages.nopload;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

// What a web view lacks and the site uses, done by Android for the app's web
// view (WebApp.java): the voices for Read aloud (window.speechSynthesis, read
// by Android's text to speech) and the print dialog (window.print in a frame,
// printed by Android's print service, which can also save a PDF). The page
// side is SCRIPT, run in every page of the site.
class Native {
    // Stands in for speechSynthesis and for print() in frames, calling the
    // bridge below; Android reports back through window.__noploadSpeech.
    static final String SCRIPT = "(()=>{if(window.__noploadNative||!window.NoploadNative)return;window.__noploadNative=1;"
            // Read aloud.
            + "const N=window.NoploadNative,q=new Map();let n=0,voices=[],paused=null,current=null;"
            + "const T=new EventTarget();"
            + "class U extends EventTarget{constructor(t){super();this.text=t||'';this.lang='';this.voice=null;this.rate=1;this.pitch=1;this.volume=1}}"
            + "const fire=(u,type,extra)=>{const e=Object.assign(new Event(type),{utterance:u,charIndex:0,charLength:0,name:'word'},extra||{});u.dispatchEvent(e);const h=u['on'+type];if(h)h.call(u,e)};"
            + "const S={get speaking(){return q.size>0&&!paused},get pending(){return q.size>1},get paused(){return !!paused},"
            + "getVoices(){return voices},"
            + "speak(u){const id=++n;q.set(id,u);N.speak(id,String(u.text),u.voice?u.voice.lang:(u.lang||''),u.voice?u.voice.name:'',Number(u.rate)||1,Number(u.pitch)||1)},"
            + "cancel(){paused=null;q.clear();N.stop()},"
            + "pause(){if(paused||!q.size)return;paused=[...q.entries()];q.clear();N.stop()},"
            + "resume(){if(!paused)return;const p=paused;paused=null;for(const[,u]of p)S.speak(u)},"
            + "addEventListener:(...a)=>T.addEventListener(...a),removeEventListener:(...a)=>T.removeEventListener(...a),onvoiceschanged:null};"
            + "window.__noploadSpeech=(id,type,a,b)=>{const u=q.get(id);if(!u)return;if(type==='boundary')fire(u,'boundary',{charIndex:a,charLength:b-a});"
            + "else{if(type!=='start')q.delete(id);fire(u,type)}};"
            + "const load=()=>{try{voices=JSON.parse(N.voices()).map(v=>({...v,voiceURI:v.name}))}catch{voices=[]}if(voices.length){const e=new Event('voiceschanged');T.dispatchEvent(e);if(S.onvoiceschanged)S.onvoiceschanged(e)}};"
            + "window.__noploadVoices=load;load();"
            + "try{Object.defineProperty(window,'speechSynthesis',{value:S,configurable:true});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:U,configurable:true})}catch{}"
            // Printing a frame: its document goes to Android's print dialog.
            + "const send=async(src,doc)=>{try{if(src&&!src.startsWith('about:')){const b=await(await fetch(src)).blob();"
            + "if(b.type==='application/pdf'){const r=new FileReader();r.onload=()=>N.printPdf(String(r.result).split(',')[1]||'',document.title);r.readAsDataURL(b);return}"
            + "N.printHtml(await b.text(),location.href);return}if(doc)N.printHtml(doc.documentElement.outerHTML,location.href)}catch(e){N.printHtml(document.documentElement.outerHTML,location.href)}};"
            // Each frame's print() is replaced as it loads, before the page's own onload runs.
            + "const hook=f=>{try{f.contentWindow.print=()=>{let doc=null;try{doc=f.contentDocument}catch{}send(f.src,doc)}}catch{}};"
            + "document.addEventListener('load',e=>{if(e.target instanceof HTMLIFrameElement)hook(e.target)},true);"
            + "document.querySelectorAll('iframe').forEach(hook);"
            + "window.print=()=>N.printHtml(document.documentElement.outerHTML,location.href);"
            + "})()";

    private final Activity activity;
    private final WebView web;
    private TextToSpeech tts;
    private boolean ready;

    Native(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    private void report(int id, String type, int a, int b) {
        activity.runOnUiThread(() -> web.evaluateJavascript("window.__noploadSpeech&&window.__noploadSpeech(" + id + ",'" + type + "'," + a + "," + b + ")", null));
    }

    // Text to speech starts with the first page; its voices arrive a moment later.
    void start() {
        tts = new TextToSpeech(activity, status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready) activity.runOnUiThread(() -> web.evaluateJavascript("window.__noploadVoices&&window.__noploadVoices()", null));
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { report(Integer.parseInt(id), "start", 0, 0); }
            @Override public void onDone(String id) { report(Integer.parseInt(id), "end", 0, 0); }
            @Override @SuppressWarnings("deprecation") public void onError(String id) { report(Integer.parseInt(id), "error", 0, 0); }
            @Override public void onStop(String id, boolean interrupted) { /* cancel() already let the page know */ }
            @Override public void onRangeStart(String id, int start, int end, int frame) { report(Integer.parseInt(id), "boundary", start, end); }
        });
    }

    void shutdown() {
        if (tts != null) tts.shutdown();
        tts = null;
    }

    @JavascriptInterface
    public String voices() {
        JSONArray out = new JSONArray();
        if (tts == null || !ready) return out.toString();
        try {
            Voice def = tts.getDefaultVoice();
            for (Voice v : tts.getVoices()) {
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                out.put(new JSONObject().put("name", v.getName()).put("lang", v.getLocale().toLanguageTag())
                        .put("localService", !v.isNetworkConnectionRequired()).put("default", def != null && def.getName().equals(v.getName())));
            }
        } catch (Exception ignored) {
            // No voices to offer.
        }
        return out.toString();
    }

    @JavascriptInterface
    public void speak(int id, String text, String lang, String voice, float rate, float pitch) {
        if (tts == null || !ready) {
            report(id, "error", 0, 0);
            return;
        }
        Voice chosen = null;
        try {
            for (Voice v : tts.getVoices()) if (v.getName().equals(voice)) chosen = v;
        } catch (Exception ignored) {
            // The default voice, then.
        }
        if (chosen != null) tts.setVoice(chosen);
        else if (!lang.isEmpty()) tts.setLanguage(Locale.forLanguageTag(lang));
        tts.setSpeechRate(rate);
        tts.setPitch(pitch);
        tts.speak(text, TextToSpeech.QUEUE_ADD, new Bundle(), String.valueOf(id));
    }

    @JavascriptInterface
    public void stop() {
        if (tts != null) tts.stop();
    }

    // An HTML page (a converted web page or Office file): laid out in a web
    // view of its own, then Android's print dialog.
    @JavascriptInterface
    public void printHtml(String html, String base) {
        activity.runOnUiThread(() -> {
            WebView page = new WebView(activity);
            page.getSettings().setJavaScriptEnabled(false);
            page.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                    pm.print("Nopload", view.createPrintDocumentAdapter("Nopload"), new PrintAttributes.Builder().build());
                }
            });
            page.loadDataWithBaseURL(base, html, "text/html", "utf-8", null);
            // Kept until the dialog has taken the document.
            web.setTag(page);
        });
    }

    // A PDF: handed to Android's print dialog as it is.
    @JavascriptInterface
    public void printPdf(String base64, String title) {
        final byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                File f = new File(activity.getCacheDir(), "print.pdf");
                try (OutputStream o = new FileOutputStream(f)) {
                    o.write(bytes);
                }
                PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                pm.print(title == null || title.isEmpty() ? "Nopload" : title, new PdfAdapter(f), null);
            } catch (Exception ignored) {
                // Nothing to print.
            }
        });
    }

    private static class PdfAdapter extends PrintDocumentAdapter {
        private final File file;

        PdfAdapter(File file) {
            this.file = file;
        }

        @Override
        public void onLayout(PrintAttributes old, PrintAttributes now, CancellationSignal cancel, LayoutResultCallback callback, Bundle extras) {
            if (cancel.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            callback.onLayoutFinished(new PrintDocumentInfo.Builder("nopload.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), !now.equals(old));
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor out, CancellationSignal cancel, WriteResultCallback callback) {
            try (InputStream in = new FileInputStream(file); OutputStream o = new FileOutputStream(out.getFileDescriptor())) {
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) o.write(buf, 0, n);
                callback.onWriteFinished(new PageRange[] {PageRange.ALL_PAGES});
            } catch (Exception e) {
                callback.onWriteFailed(e.getMessage());
            }
        }
    }
}
