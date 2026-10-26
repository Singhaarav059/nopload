package dev.pages.nopload;

import android.app.Application;
import android.os.Build;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;

// Keeps the reason for a crash, so the next launch can show it (Launcher.java)
// and it can be sent on: nothing leaves the phone unless the person copies it.
public class App extends Application {
    static final String CRASH = "last-crash.txt";

    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler next = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, e) -> {
            try {
                StringWriter trace = new StringWriter();
                e.printStackTrace(new PrintWriter(trace));
                String report = "Nopload " + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")\n"
                        + "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + "), "
                        + Build.MANUFACTURER + " " + Build.MODEL + "\n\n" + trace;
                try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), CRASH))) {
                    out.write(report.getBytes(StandardCharsets.UTF_8));
                }
            } catch (Throwable ignored) {
                // Nothing more can be done while crashing.
            }
            if (next != null) next.uncaughtException(thread, e);
        });
    }
}
