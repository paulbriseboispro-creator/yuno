// Bundle de l'extension YunoWidgets — héberge la Live Activity de suivi de
// commande ET le widget d'écran d'accueil « Prochaine soirée ».
// TARGET MEMBERSHIP : YunoWidgets uniquement.
import WidgetKit
import SwiftUI

@main
struct YunoWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NextEventWidget()
        if #available(iOS 16.2, *) {
            OrderActivityWidget()
        }
    }
}
