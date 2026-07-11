// Plugin Capacitor maison « OrderActivity » — Live Activity de suivi de
// commande. Maison parce que les plugins communautaires n'exposent pas les
// push tokens ActivityKit, or le chemin qui compte est le push serveur
// (téléphone en poche en boîte).
//
// TARGET MEMBERSHIP : App uniquement.
// Enregistrement : Capacitor 8 ne découvre plus les plugins locaux tout seul —
// voir MyViewController.swift (bridge?.registerPluginInstance).
//
// Contrat JS (src/lib/liveActivity.ts) :
//   start({orderId,title,status,pin,items}) → { activityId }
//   update({orderId,status,pin,items})      → void
//   end({orderId,status})                   → void
//   event "pushToken" { orderId, activityId, pushToken } (hex, + rotations)
import Foundation
import Capacitor
import ActivityKit

@objc(OrderActivityPlugin)
public class OrderActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OrderActivityPlugin"
    public let jsName = "OrderActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities require iOS 16.2+")
            return
        }
        guard let orderId = call.getString("orderId") else {
            call.reject("orderId required")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("Live Activities disabled by user")
            return
        }

        let state = OrderAttributes.ContentState(
            status: call.getString("status") ?? "pending",
            pin: call.getString("pin"),
            items: call.getString("items") ?? ""
        )

        // Relance de l'app en cours de soirée : ré-attache l'activité vivante
        // du même orderId au lieu d'en empiler une deuxième.
        if let existing = Activity<OrderAttributes>.activities.first(where: { $0.attributes.orderId == orderId }) {
            observeTokens(existing, orderId: orderId)
            Task { await existing.update(ActivityContent(state: state, staleDate: nil)) }
            call.resolve(["activityId": existing.id])
            return
        }

        do {
            let activity = try Activity.request(
                attributes: OrderAttributes(orderId: orderId, title: call.getString("title") ?? "Yuno"),
                content: ActivityContent(state: state, staleDate: nil),
                pushType: .token
            )
            observeTokens(activity, orderId: orderId)
            call.resolve(["activityId": activity.id])
        } catch {
            call.reject("start failed: \(error.localizedDescription)")
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.reject("iOS 16.2+"); return }
        guard let orderId = call.getString("orderId"),
              let activity = Activity<OrderAttributes>.activities.first(where: { $0.attributes.orderId == orderId }) else {
            call.reject("no activity for order")
            return
        }
        let state = OrderAttributes.ContentState(
            status: call.getString("status") ?? "pending",
            pin: call.getString("pin"),
            items: call.getString("items") ?? ""
        )
        Task {
            await activity.update(ActivityContent(state: state, staleDate: nil))
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.reject("iOS 16.2+"); return }
        guard let orderId = call.getString("orderId"),
              let activity = Activity<OrderAttributes>.activities.first(where: { $0.attributes.orderId == orderId }) else {
            call.resolve() // déjà terminée : succès silencieux
            return
        }
        let state = OrderAttributes.ContentState(
            status: call.getString("status") ?? "served",
            pin: nil,
            items: activity.content.state.items
        )
        Task {
            await activity.end(
                ActivityContent(state: state, staleDate: nil),
                dismissalPolicy: .after(Date().addingTimeInterval(30 * 60))
            )
            call.resolve()
        }
    }

    @available(iOS 16.2, *)
    private func observeTokens(_ activity: Activity<OrderAttributes>, orderId: String) {
        Task {
            for await tokenData in activity.pushTokenUpdates {
                let hex = tokenData.map { String(format: "%02x", $0) }.joined()
                self.notifyListeners("pushToken", data: [
                    "orderId": orderId,
                    "activityId": activity.id,
                    "pushToken": hex,
                ])
            }
        }
    }
}
