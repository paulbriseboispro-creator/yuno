// Plugin Capacitor maison « WalletSheet » — présente la sheet d'ajout Apple
// Wallet (PKAddPassesViewController) depuis un .pkpass base64. Maison parce
// que le projet est 100 % SPM et que capacitor-pass-to-wallet n'existe qu'en
// CocoaPods. ~30 lignes de PassKit, zéro dépendance.
//
// TARGET MEMBERSHIP : App uniquement.
// Enregistré dans MyViewController.swift (registerPluginInstance).
// Contrat JS (src/lib/wallet.ts) : addPass({ base64 }) → résout à la
// présentation de la sheet, rejette si le pass est invalide.
import Foundation
import Capacitor
import PassKit

@objc(WalletSheetPlugin)
public class WalletSheetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WalletSheetPlugin"
    public let jsName = "WalletSheet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "addPass", returnType: CAPPluginReturnPromise),
    ]

    @objc func addPass(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"), let data = Data(base64Encoded: b64) else {
            call.reject("base64 required")
            return
        }
        guard PKAddPassesViewController.canAddPasses() else {
            call.reject("Wallet unavailable on this device")
            return
        }
        do {
            let pass = try PKPass(data: data)
            DispatchQueue.main.async {
                guard let sheet = PKAddPassesViewController(pass: pass),
                      let host = self.bridge?.viewController else {
                    call.reject("cannot present Wallet sheet")
                    return
                }
                host.present(sheet, animated: true) {
                    call.resolve()
                }
            }
        } catch {
            call.reject("invalid pass: \(error.localizedDescription)")
        }
    }
}
