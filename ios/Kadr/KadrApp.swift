import SwiftUI
import UIKit
import WebKit

@main
struct KadrApp: App {
    var body: some Scene {
        WindowGroup {
            WebScreen().ignoresSafeArea()
        }
    }
}

struct WebScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ vc: WebViewController, context: Context) {}
}

final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let home = URL(string: "https://getkadr.space/")!
    private let oldHost = "kadr.193-247-73-123.sslip.io"
    private var web: WKWebView!
    private let offline = UIStackView()

    private static let background = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.075, green: 0.086, blue: 0.137, alpha: 1)
            : UIColor.white
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.background

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "Mobile/15E148 KadrApp/2"
        config.websiteDataStore = .default()

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = Self.background
        web.scrollView.backgroundColor = Self.background
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pullToRefresh(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh

        buildOfflineView()
        web.load(URLRequest(url: home))
    }

    private func buildOfflineView() {
        let title = UILabel()
        title.text = "Нет связи с Кадром"
        title.font = .systemFont(ofSize: 22, weight: .bold)
        title.textAlignment = .center

        let hint = UILabel()
        hint.text = "Проверьте интернет. Если включён VPN, попробуйте его выключить."
        hint.font = .systemFont(ofSize: 15)
        hint.textColor = .secondaryLabel
        hint.textAlignment = .center
        hint.numberOfLines = 0

        var cfg = UIButton.Configuration.filled()
        cfg.title = "Повторить"
        cfg.baseBackgroundColor = UIColor(red: 0.196, green: 0.275, blue: 0.902, alpha: 1)
        cfg.cornerStyle = .large
        let retry = UIButton(configuration: cfg, primaryAction: UIAction { [weak self] _ in
            guard let self else { return }
            self.offline.isHidden = true
            self.triedFallback = false
            self.web.load(URLRequest(url: self.home))
        })

        offline.axis = .vertical
        offline.spacing = 14
        offline.alignment = .center
        offline.addArrangedSubview(title)
        offline.addArrangedSubview(hint)
        offline.addArrangedSubview(retry)
        offline.isHidden = true
        offline.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(offline)
        NSLayoutConstraint.activate([
            offline.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            offline.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            offline.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
    }

    @objc private func pullToRefresh(_ control: UIRefreshControl) {
        web.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { control.endRefreshing() }
    }

    // Links to other sites open in Safari.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, let host = url.host, host != home.host, host != oldHost,
           action.targetFrame?.isMainFrame ?? true {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    private var triedFallback = false
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // new domain not reachable yet -> try the old address once
        if !triedFallback, let failed = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL ?? webView.url,
           failed.host == home.host, var c = URLComponents(url: failed, resolvingAgainstBaseURL: false) {
            triedFallback = true
            c.host = oldHost
            if let u = c.url { webView.load(URLRequest(url: u)); return }
        }
        offline.isHidden = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offline.isHidden = true
    }
}
