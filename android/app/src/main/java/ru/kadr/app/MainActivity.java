package ru.kadr.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    static final String HOST = "getkadr.space";
    static final String OLD_HOST = "kadr.193-247-73-123.sslip.io";
    static final String HOME = "https://" + HOST + "/";
    static final int FILE_REQ = 1;

    private WebView web;
    private View offline;
    private ValueCallback<Uri[]> fileCallback;
    private boolean triedFallback = false;

    private boolean isDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        int bg = isDark() ? Color.parseColor("#131623") : Color.WHITE;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(bg);

        web = new WebView(this);
        web.setBackgroundColor(bg);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUserAgentString(s.getUserAgentString() + " KadrApp/2");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost()) || OLD_HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                String url = req.getUrl().toString();
                view.stopLoading();
                // new domain not reachable (DNS not propagated, VPN cache) -> try the old address once
                if (HOST.equals(req.getUrl().getHost()) && !triedFallback) {
                    triedFallback = true;
                    view.loadUrl(url.replace(HOST, OLD_HOST));
                    return;
                }
                view.loadUrl("about:blank");
                offline.setVisibility(View.VISIBLE);
                offline.bringToFront();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = params.createIntent();
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                String[] types = params.getAcceptTypes();
                if (types != null && types.length > 0 && !(types.length == 1 && types[0].isEmpty())) {
                    pick.setType("*/*");
                    pick.putExtra(Intent.EXTRA_MIME_TYPES, types);
                }
                try {
                    startActivityForResult(Intent.createChooser(pick, "Выберите фото или видео"), FILE_REQ);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offline = buildOffline(bg);
        root.addView(offline, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (state != null) web.restoreState(state);
        else load(getIntent());
    }

    private View buildOffline(int bg) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(bg);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Нет связи с Кадром");
        title.setTextSize(20);
        title.setTextColor(isDark() ? Color.parseColor("#EDEFF7") : Color.parseColor("#151826"));
        title.setGravity(Gravity.CENTER);

        TextView hint = new TextView(this);
        hint.setText("Проверьте интернет. Если включён VPN, попробуйте его выключить.");
        hint.setTextSize(15);
        hint.setTextColor(Color.parseColor("#8C93AD"));
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, pad / 2, 0, pad);

        Button retry = new Button(this);
        retry.setText("Повторить");
        retry.setOnClickListener(v -> {
            offline.setVisibility(View.GONE);
            triedFallback = false;
            web.loadUrl(HOME);
        });

        box.addView(title);
        box.addView(hint);
        box.addView(retry);
        box.setVisibility(View.GONE);
        return box;
    }

    private void load(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && (HOST.equals(data.getHost()) || OLD_HOST.equals(data.getHost()))) web.loadUrl(data.toString().replace(OLD_HOST, HOST));
        else web.loadUrl(HOME);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getData() != null) load(intent);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQ && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE) { super.onBackPressed(); return; }
        web.evaluateJavascript("(window.kadrBack&&window.kadrBack())?'1':'0'", result -> {
            if (!"\"1\"".equals(result)) {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }
}
