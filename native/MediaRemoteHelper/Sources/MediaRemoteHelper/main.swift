import Foundation
import MediaRemoteAdapter

func emit(_ payload: Any) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload),
          let text = String(data: data, encoding: .utf8) else {
        fputs("null\n", stdout)
        fflush(stdout)
        return
    }
    fputs("\(text)\n", stdout)
    fflush(stdout)
}

func mediaPayload(from trackInfo: TrackInfo) -> [String: Any] {
    let payload = trackInfo.payload
    let duration = (payload.durationMicros ?? 0) / 1_000_000
    let elapsed = payload.currentElapsedTime ?? ((payload.elapsedTimeMicros ?? 0) / 1_000_000)
    let sourceName = payload.applicationName ?? payload.bundleIdentifier ?? "System audio"
    let id = [
        payload.bundleIdentifier ?? "",
        payload.title ?? "",
        payload.artist ?? "",
        payload.album ?? ""
    ].joined(separator: "::")

    return [
        "id": id,
        "title": payload.title ?? "",
        "artist": payload.artist ?? "",
        "album": payload.album ?? "",
        "sourceName": sourceName,
        "duration": max(0, duration),
        "position": max(0, elapsed),
        "playbackState": payload.isPlaying == false ? "paused" : "playing",
        "playbackRate": payload.playbackRate ?? NSNull(),
        "bundleIdentifier": payload.bundleIdentifier ?? ""
    ]
}

let controller = MediaController()
var didFinish = false

func finish() {
    guard !didFinish else {
        return
    }
    didFinish = true
    exit(0)
}

controller.getTrackInfo { trackInfo in
    if let trackInfo {
        emit(mediaPayload(from: trackInfo))
    } else {
        fputs("null\n", stdout)
        fflush(stdout)
    }
    finish()
}

DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(900)) {
    guard !didFinish else {
        return
    }
    fputs("null\n", stdout)
    fflush(stdout)
    finish()
}

RunLoop.main.run()
