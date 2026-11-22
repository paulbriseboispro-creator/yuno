import UIKit
import Capacitor

/// Cycle de vie par scène, obligatoire depuis iOS 27 : une app sans
/// `UIApplicationSceneManifest` y est tuée au lancement (« UIScene life cycle
/// is required for apps built with this SDK »). La fenêtre vit ici, plus dans
/// l'AppDelegate ; le storyboard `Main` (CAPBridgeViewController) est chargé
/// par le manifeste de l'Info.plist.
///
/// Avec des scènes, iOS ne passe plus les liens (schéma `yuno…://`, Universal
/// Links) à l'AppDelegate mais à la scène : on les renvoie au proxy de
/// Capacitor, qui alimente le plugin App (`appUrlOpen`, `getLaunchUrl`).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    private var urlObservation: NSKeyValueObservation?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }

        // Lancement à froid par un lien : iOS le donne ici, pas à openURLContexts.
        for context in connectionOptions.urlContexts {
            openURL(context)
        }
        for activity in connectionOptions.userActivities {
            continueActivity(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            openURL(context)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        continueActivity(userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Swipe back natif : geste bord-écran du WKWebView, coupé sur les pages
        // qui gardent leur sortie côté web (AppDelegate.guardsItsOwnBack).
        guard let vc = window?.rootViewController as? CAPBridgeViewController,
              let webView = vc.webView else { return }

        webView.allowsBackForwardNavigationGestures = !AppDelegate.guardsItsOwnBack(webView.url)

        if urlObservation == nil {
            urlObservation = webView.observe(\.url, options: [.new]) { wv, _ in
                wv.allowsBackForwardNavigationGestures = !AppDelegate.guardsItsOwnBack(wv.url)
            }
        }
    }

    private func openURL(_ context: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication {
            options[.sourceApplication] = source
        }
        if let annotation = context.options.annotation {
            options[.annotation] = annotation
        }
        options[.openInPlace] = context.options.openInPlace
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
    }

    private func continueActivity(_ activity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
}
