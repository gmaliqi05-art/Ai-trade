package com.margroup.goldtrade;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// GOLDTRADE — mbështjellësi Android i platformës web.
// QËLLIMI KRYESOR: bllokimi i VËRTETË i screenshot-eve me FLAG_SECURE — sistemi operativ e
// refuzon kapjen e ekranit (screenshot/regjistrim/screen-share dalin të zeza ose me mesazhin
// e sistemit "Nuk lejohet për shkak të politikës së sigurisë").
//
// Ura "AndroidShield": komponenti web ScreenshotShield e thërret setCaptureAllowed(true)
// VETËM për llogarinë e përjashtuar (marbaudoo@gmail.com) — asaj i lejohet kapja edhe këtu.
public class MainActivity extends Activity {

    // ADRESA E PLATFORMËS — e vetmja vlerë për t'u ndryshuar nëse ndërron domeni.
    private static final String APP_URL = "https://www.goldsniper.vip/";

    // Host-et që hapen BRENDA aplikacionit (platforma + pagesat Stripe).
    // Çdo host tjetër (t.me, vantagemarkets, metaapi...) hapet në shfletues/aplikacion të jashtëm.
    private static final String[] INTERNAL_HOSTS = {
            "goldsniper.vip",
            "www.goldsniper.vip",
            "checkout.stripe.com",
            "billing.stripe.com",
    };

    private static final int FILE_REQ = 71;
    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // BLLOKIMI I SCREENSHOT-EVE — aktiv që në nisje, hiqet vetëm nga ura për të përjashtuarit.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false; // iframe-t (grafiku TradingView) mbeten brenda
                Uri u = request.getUrl();
                String h = u.getHost() == null ? "" : u.getHost();
                for (String ih : INTERNAL_HOSTS) if (h.equalsIgnoreCase(ih)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                // Ngarkimi i fotos së profilit nga galeria/kamera.
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQ);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new ShieldBridge(), "AndroidShield");
        web.loadUrl(APP_URL);
        setContentView(web);
    }

    /** Ura JS ↔ Android: platforma web njofton se kush është i kyçur; kapja lejohet vetëm për të përjashtuarit. */
    public class ShieldBridge {
        @JavascriptInterface
        public void setCaptureAllowed(final boolean allowed) {
            runOnUiThread(() -> {
                if (allowed) getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                else getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQ && filePathCallback != null) {
            filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        // Butoni "mbrapa" lëviz në historikun e platformës; del nga aplikacioni vetëm në fillim.
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
