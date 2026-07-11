// Enregistrement des plugins Capacitor LOCAUX (Capacitor 8 : plus de
// découverte automatique ObjC — les plugins maison passent par
// registerPluginInstance dans une sous-classe du bridge).
//
// TARGET MEMBERSHIP : App uniquement.
// ⚠️ Dans Main.storyboard, régler la Custom Class du view controller sur
// « MyViewController » (module App) — sinon ce fichier est ignoré et le
// plugin OrderActivity n'existe pas côté JS.
import UIKit
import Capacitor

class MyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OrderActivityPlugin())
    }
}
