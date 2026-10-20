import AppKit
import Foundation
import MediaRemoteAdapter

// Long-running helper: streams now-playing changes as JSON lines on stdout.
//   {"type":"mediaRemote","track":{...}|null}
//   {"type":"spotify","track":{...}|null}
// Each track carries `position` (seconds) valid at `positionTimestamp` (epoch ms).

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let text = String(data: data, encoding: .utf8) else {
        return
    }
    fputs("\(text)\n", stdout)
    fflush(stdout)
}

func debugLog(_ message: String) {
    guard ProcessInfo.processInfo.environment["MUSICVIS_DEBUG"] == "1" else {
        return
    }
    fputs("\(message)\n", stderr)
    fflush(stderr)
}

func epochMillis() -> Double {
    Date().timeIntervalSince1970 * 1000
}

final class MediaRemoteSource {
    private let controller = MediaController()
    private var lastArtworkKey = ""

    func start() {
        controller.onTrackInfoReceived = { [weak self] trackInfo in
            self?.handle(trackInfo)
        }
        controller.onListenerTerminated = { [weak self] in
            debugLog("mediaremote listener terminated, restarting")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                self?.controller.startListening()
            }
        }
        controller.onDecodingError = { error, _ in
            debugLog("mediaremote decode failed error=\"\(error.localizedDescription)\"")
        }
        controller.startListening()
    }

    private func handle(_ trackInfo: TrackInfo?) {
        guard let payload = trackInfo?.payload, let title = payload.title, !title.isEmpty else {
            lastArtworkKey = ""
            emit(["type": "mediaRemote", "track": NSNull()])
            return
        }

        let id = [payload.bundleIdentifier ?? "", title, payload.artist ?? "", payload.album ?? ""].joined(separator: "::")
        let elapsed = (payload.elapsedTimeMicros ?? 0) / 1_000_000
        let timestamp = payload.timestampEpochMicros.map { $0 / 1000 } ?? epochMillis()
        var track: [String: Any] = [
            "id": id,
            "title": title,
            "artist": payload.artist ?? "",
            "album": payload.album ?? "",
            "sourceName": payload.applicationName ?? payload.bundleIdentifier ?? "System audio",
            "duration": max(0, (payload.durationMicros ?? 0) / 1_000_000),
            "position": max(0, elapsed),
            "positionTimestamp": timestamp,
            "playbackState": payload.isPlaying == true ? "playing" : "paused"
        ]

        // Artwork is large; only send it when it changes for the current track.
        if let artwork = payload.artworkDataBase64, !artwork.isEmpty {
            let artworkKey = "\(id)#\(artwork.count)"
            if artworkKey != lastArtworkKey {
                lastArtworkKey = artworkKey
                track["artworkDataBase64"] = artwork
                track["artworkMimeType"] = payload.artworkMimeType ?? NSNull()
            }
        }

        emit(["type": "mediaRemote", "track": track])
    }
}

final class SpotifySource {
    private static let bundleIdentifier = "com.spotify.client"
    private static let resyncInterval: TimeInterval = 2

    // Individual getters avoid Spotify's broken properties() AppleEvent handler.
    private let script = NSAppleScript(source: """
    tell application id "com.spotify.client"
      set t to current track
      return {id of t, name of t, artist of t, album of t, duration of t, player position, (player state as string), artwork url of t}
    end tell
    """)
    private var isPlaying = false
    private var hasTrack = false
    private var lastScriptError = ""

    func start() {
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.spotify.client.PlaybackStateChanged"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            debugLog("spotify notification")
            self?.refresh(userInfo: notification.userInfo)
        }

        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            if app?.bundleIdentifier == SpotifySource.bundleIdentifier {
                self?.publish(nil)
            }
        }

        // Spotify does not reliably notify on seek, so re-read the position while playing.
        Timer.scheduledTimer(withTimeInterval: SpotifySource.resyncInterval, repeats: true) { [weak self] _ in
            guard let self, self.isPlaying else {
                return
            }
            self.refresh(userInfo: nil)
        }

        refresh(userInfo: nil)
    }

    private var isRunning: Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: SpotifySource.bundleIdentifier).isEmpty
    }

    private func refresh(userInfo: [AnyHashable: Any]?) {
        guard isRunning else {
            publish(nil)
            return
        }
        if let track = queryScript() ?? userInfo.flatMap(trackFromNotification) {
            publish(track)
        }
    }

    private func queryScript() -> [String: Any]? {
        var error: NSDictionary?
        guard let result = script?.executeAndReturnError(&error), result.numberOfItems >= 8 else {
            let message = (error?[NSAppleScript.errorMessage] as? String) ?? "no result"
            if message != lastScriptError {
                lastScriptError = message
                fputs("Spotify AppleScript failed: \(message)\n", stderr)
            }
            return nil
        }
        lastScriptError = ""

        func string(_ index: Int) -> String {
            result.atIndex(index)?.stringValue ?? ""
        }
        func number(_ index: Int) -> Double {
            result.atIndex(index)?.doubleValue ?? 0
        }

        let title = string(2)
        guard !title.isEmpty else {
            return nil
        }
        let artworkUrl = string(8)
        return [
            "id": string(1),
            "title": title,
            "artist": string(3),
            "album": string(4),
            "sourceName": "Spotify",
            // Spotify returns milliseconds despite the scripting dictionary saying seconds.
            "duration": max(0, number(5) / 1000),
            "position": max(0, number(6)),
            "positionTimestamp": epochMillis(),
            "playbackState": string(7),
            "artworkUrl": artworkUrl.isEmpty ? NSNull() : artworkUrl
        ]
    }

    private func trackFromNotification(_ userInfo: [AnyHashable: Any]) -> [String: Any]? {
        guard let title = userInfo["Name"] as? String, !title.isEmpty else {
            return nil
        }
        let state = (userInfo["Player State"] as? String)?.lowercased() ?? "paused"
        return [
            "id": userInfo["Track ID"] as? String ?? "",
            "title": title,
            "artist": userInfo["Artist"] as? String ?? "",
            "album": userInfo["Album"] as? String ?? "",
            "sourceName": "Spotify",
            "duration": max(0, ((userInfo["Duration"] as? NSNumber)?.doubleValue ?? 0) / 1000),
            "position": max(0, (userInfo["Playback Position"] as? NSNumber)?.doubleValue ?? 0),
            "positionTimestamp": epochMillis(),
            "playbackState": state
        ]
    }

    private func publish(_ track: [String: Any]?) {
        isPlaying = (track?["playbackState"] as? String) == "playing"
        if track == nil && !hasTrack {
            return
        }
        hasTrack = track != nil
        emit(["type": "spotify", "track": track ?? NSNull()])
    }
}

signal(SIGTERM, SIG_DFL)

// The adapter ignores SIGPIPE, so a dead parent would not kill us; watch for reparenting instead.
Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
    if getppid() == 1 {
        exit(0)
    }
}

// Spotify first: its synchronous initial read lands before MediaRemote's
// (often stale) Spotify session, so the UI never flashes a wrong position.
let spotify = SpotifySource()
let mediaRemote = MediaRemoteSource()
if ProcessInfo.processInfo.environment["MUSICVIS_SPOTIFY_DIRECT"] != "0" {
    spotify.start()
}
mediaRemote.start()

RunLoop.main.run()
