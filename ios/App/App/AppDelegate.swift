import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    /// Pages qui gardent leur sortie côté web (confirmation avant de quitter).
    /// Le geste bord-écran y est coupé : il n'est pas annulable une fois lancé,
    /// et le laisser actif faisait glisser l'écran avant que la question
    /// n'apparaisse — un aller-retour visuel pour rien. Ailleurs, le geste reste
    /// celui d'une app iOS classique.
    static func guardsItsOwnBack(_ url: URL?) -> Bool {
        guard let path = url?.path else { return false }
        return path.hasSuffix("/guestlist")
    }

    private var urlObservation: NSKeyValueObservation?

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Swipe back natif : active le geste bord-écran du WKWebView. L'historique
        // SPA (pushState) est dans la back-forward list du WebView, donc le geste
        // dépile la navigation comme une app iOS classique. Idempotent.
        guard let vc = window?.rootViewController as? CAPBridgeViewController,
              let webView = vc.webView else { return }

        webView.allowsBackForwardNavigationGestures = !AppDelegate.guardsItsOwnBack(webView.url)

        // `url` est observable et suit les pushState/replaceState de la SPA :
        // le geste se recoupe et se rétablit page par page, sans plugin.
        if urlObservation == nil {
            urlObservation = webView.observe(\.url, options: [.new]) { wv, _ in
                wv.allowsBackForwardNavigationGestures = !AppDelegate.guardsItsOwnBack(wv.url)
            }
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // APNs → @capacitor/push-notifications (requis par le plugin).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
