// Live Activity « suivi de commande » — écran verrouillé + Dynamic Island.
// TARGET MEMBERSHIP : YunoWidgets uniquement (OrderAttributes.swift est
// partagé App + YunoWidgets).
//
// Esthétique éditoriale Yuno : fond #0A0A0A, rouge #E8192C, vert prêt
// #34D399, kicker mono uppercase. Labels localisés FR/EN/ES par la locale
// système (le contenu dynamique arrive du serveur dans content-state).
import ActivityKit
import WidgetKit
import SwiftUI

private let yunoRed = Color(red: 232 / 255, green: 25 / 255, blue: 44 / 255)
private let yunoGreen = Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255)
private let yunoBg = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)

private func statusLabel(_ status: String) -> String {
    let lang = Locale.preferredLanguages.first?.prefix(2) ?? "en"
    switch status {
    case "ready":
        return lang == "fr" ? "PRÊTE" : lang == "es" ? "LISTA" : "READY"
    case "preparing":
        return lang == "fr" ? "EN PRÉPARATION" : lang == "es" ? "EN PREPARACIÓN" : "PREPARING"
    case "served":
        return lang == "fr" ? "SERVIE" : lang == "es" ? "SERVIDA" : "SERVED"
    default:
        return lang == "fr" ? "REÇUE" : lang == "es" ? "RECIBIDA" : "RECEIVED"
    }
}

private func pickupLabel() -> String {
    let lang = Locale.preferredLanguages.first?.prefix(2) ?? "en"
    return lang == "fr" ? "Montre ce code au bar" : lang == "es" ? "Muestra este código en la barra" : "Show this code at the bar"
}

private func statusColor(_ status: String) -> Color {
    status == "ready" ? yunoGreen : status == "served" ? .gray : yunoRed
}

private func stepIndex(_ status: String) -> Int {
    switch status {
    case "preparing": return 1
    case "ready", "served": return 2
    default: return 0
    }
}

/// Barre de progression 3 étapes — miroir de LiveOrderStatus.tsx.
@available(iOS 16.2, *)
private struct StepsBar: View {
    let status: String
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(i <= stepIndex(status) ? statusColor(status) : Color.white.opacity(0.12))
                    .frame(height: 4)
            }
        }
    }
}

@available(iOS 16.2, *)
struct OrderActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OrderAttributes.self) { context in
            // ── Écran verrouillé ─────────────────────────────────────────
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(context.attributes.title.uppercased())
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .kerning(1.2)
                        .foregroundColor(yunoRed)
                    Spacer()
                    Text(statusLabel(context.state.status))
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .kerning(1.0)
                        .foregroundColor(statusColor(context.state.status))
                }
                if !context.state.items.isEmpty {
                    Text(context.state.items)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                }
                StepsBar(status: context.state.status)
                if context.state.status == "ready", let pin = context.state.pin {
                    HStack {
                        Text(pickupLabel())
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.6))
                        Spacer()
                        Text(pin)
                            .font(.system(size: 16, weight: .bold, design: .monospaced))
                            .kerning(2)
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.white.opacity(0.08))
                            .cornerRadius(5)
                    }
                }
            }
            .padding(14)
            .activityBackgroundTint(yunoBg)
            .activitySystemActionForegroundColor(.white)
            .widgetURL(URL(string: "yuno://open?path=/live"))

        } dynamicIsland: { context in
            DynamicIsland {
                // ── Île étendue ──────────────────────────────────────────
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.title.uppercased())
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .kerning(1.0)
                        .foregroundColor(yunoRed)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(statusLabel(context.state.status))
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(statusColor(context.state.status))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        if !context.state.items.isEmpty {
                            Text(context.state.items)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.white)
                                .lineLimit(1)
                        }
                        StepsBar(status: context.state.status)
                        if context.state.status == "ready", let pin = context.state.pin {
                            Text(pin)
                                .font(.system(size: 15, weight: .bold, design: .monospaced))
                                .kerning(2)
                                .foregroundColor(.white)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: context.state.status == "ready" ? "checkmark.circle.fill" : "wineglass.fill")
                    .foregroundColor(statusColor(context.state.status))
            } compactTrailing: {
                if context.state.status == "ready", let pin = context.state.pin {
                    Text(pin)
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(yunoGreen)
                } else {
                    Circle()
                        .fill(statusColor(context.state.status))
                        .frame(width: 8, height: 8)
                }
            } minimal: {
                Image(systemName: context.state.status == "ready" ? "checkmark.circle.fill" : "wineglass.fill")
                    .foregroundColor(statusColor(context.state.status))
            }
            .widgetURL(URL(string: "yuno://open?path=/live"))
            .keylineTint(yunoRed)
        }
    }
}
