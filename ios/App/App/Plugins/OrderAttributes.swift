// Attributs de la Live Activity « suivi de commande ».
// ⚠️ TARGET MEMBERSHIP : App ET YunoWidgets (le plugin démarre l'activité,
// l'extension la rend). Le ContentState doit rester le MIROIR EXACT du
// content-state envoyé par le serveur (send-push-notification, action
// live_activity_update) : { status, pin, items }.
import ActivityKit

struct OrderAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// pending | preparing | ready | served
        var status: String
        /// 4 derniers caractères du token de retrait (montré au bar)
        var pin: String?
        /// Résumé des items ("2× Mojito · 1× Coca")
        var items: String
    }

    /// UUID de la commande (orders.id) — clé de ré-attachement.
    var orderId: String
    /// Titre localisé, fourni par l'app au démarrage.
    var title: String
}
