// Widget « Prochaine soirée » — small + medium. Lit le App Group
// (group.eu.yunoapp.app, clé yuno.nextEvent) alimenté par
// src/lib/widgetData.ts après chargement des billets.
// TARGET MEMBERSHIP : YunoWidgets uniquement.
//
// Leçon Duolingo : une surface que l'utilisateur a CHOISIE peut se mettre à
// jour en continu sans jamais être du spam. Pas de streak ici — un compte à
// rebours vers la prochaine soirée, ou une invitation à explorer.
import WidgetKit
import SwiftUI

private let yunoRed = Color(red: 232 / 255, green: 25 / 255, blue: 44 / 255)
private let yunoBg = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)

private let appGroup = "group.eu.yunoapp.app"
private let storageKey = "yuno.nextEvent"

// containerBackground(for:.widget) est iOS 17+ ; la target descend à 16.2.
private extension View {
    @ViewBuilder
    func yunoWidgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { color }
        } else {
            background(color)
        }
    }
}

struct NextEventData: Codable {
    let title: String
    let venueName: String
    let startAt: String
    let posterUrl: String?
}

struct NextEventEntry: TimelineEntry {
    let date: Date
    let event: NextEventData?
    let startDate: Date?
}

private func loadNextEvent() -> NextEventEntry {
    let defaults = UserDefaults(suiteName: appGroup)
    guard
        let raw = defaults?.string(forKey: storageKey),
        let data = raw.data(using: .utf8),
        let event = try? JSONDecoder().decode(NextEventData.self, from: data)
    else {
        return NextEventEntry(date: Date(), event: nil, startDate: nil)
    }
    let start = ISO8601DateFormatter().date(from: event.startAt)
        ?? { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f.date(from: event.startAt) }()
    // Soirée passée depuis plus de 6h : état vide.
    if let start, start.addingTimeInterval(6 * 3600) < Date() {
        return NextEventEntry(date: Date(), event: nil, startDate: nil)
    }
    return NextEventEntry(date: Date(), event: event, startDate: start)
}

struct NextEventProvider: TimelineProvider {
    func placeholder(in _: Context) -> NextEventEntry {
        NextEventEntry(
            date: Date(),
            event: NextEventData(title: "Yuno Electronic Body", venueName: "Womber", startAt: "2026-07-12T22:00:00+02:00", posterUrl: nil),
            startDate: Date().addingTimeInterval(8 * 3600)
        )
    }

    func getSnapshot(in _: Context, completion: @escaping (NextEventEntry) -> Void) {
        completion(loadNextEvent())
    }

    func getTimeline(in _: Context, completion: @escaping (Timeline<NextEventEntry>) -> Void) {
        let entry = loadNextEvent()
        // Re-calcul dans 1h (ou à l'heure de l'événement si plus proche) ;
        // reloadAllTimelines() côté app force le refresh dès qu'un billet change.
        var next = Date().addingTimeInterval(3600)
        if let start = entry.startDate, start > Date(), start < next {
            next = start
        }
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

private func kicker(_ lang: String) -> String {
    lang == "fr" ? "PROCHAINE SOIRÉE" : lang == "es" ? "PRÓXIMA NOCHE" : "NEXT NIGHT OUT"
}

private func emptyLine(_ lang: String) -> String {
    lang == "fr" ? "Explore les soirées autour de toi" : lang == "es" ? "Explora las fiestas cerca de ti" : "Explore nights near you"
}

struct NextEventWidgetView: View {
    var entry: NextEventEntry
    @Environment(\.widgetFamily) var family
    private var lang: String { String(Locale.preferredLanguages.first?.prefix(2) ?? "en") }

    var body: some View {
        content
            .yunoWidgetBackground(yunoBg)
            .widgetURL(URL(string: entry.event == nil ? "yuno://open?path=/" : "yuno://open?path=/my-orders"))
    }

    @ViewBuilder
    private var content: some View {
        if let event = entry.event {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Rectangle().fill(yunoRed).frame(width: 16, height: 2)
                    Text(kicker(lang))
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .kerning(1.2)
                        .foregroundColor(Color.white.opacity(0.55))
                }
                Spacer(minLength: 0)
                Text(event.title)
                    .font(.system(size: family == .systemSmall ? 15 : 18, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(2)
                Text(event.venueName)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Color.white.opacity(0.6))
                    .lineLimit(1)
                if let start = entry.startDate {
                    Text(start, style: .relative)
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundColor(yunoRed)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Rectangle().fill(yunoRed).frame(width: 16, height: 2)
                    Text("YUNO")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .kerning(1.4)
                        .foregroundColor(yunoRed)
                }
                Spacer(minLength: 0)
                Text(emptyLine(lang))
                    .font(.system(size: family == .systemSmall ? 13 : 16, weight: .semibold))
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

struct NextEventWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "YunoNextEvent", provider: NextEventProvider()) { entry in
            NextEventWidgetView(entry: entry)
        }
        .configurationDisplayName("Yuno")
        .description("Ta prochaine soirée, en compte à rebours.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
