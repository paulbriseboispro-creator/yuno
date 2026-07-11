// Enregistrement des plugins Capacitor LOCAUX (Capacitor 8 : plus de
// découverte automatique ObjC — les plugins maison passent par
// registerPluginInstance dans une sous-classe du bridge).
//
// TARGET MEMBERSHIP : App uniquement.
// Main.storyboard pointe sa Custom Class ici — sans ça, les plugins
// OrderActivity et WalletSheet n'existent pas côté JS.
import UIKit
import Capacitor

class MyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OrderActivityPlugin())
        bridge?.registerPluginInstance(WalletSheetPlugin())
    }
}
