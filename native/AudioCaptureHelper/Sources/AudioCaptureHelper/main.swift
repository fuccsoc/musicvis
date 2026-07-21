import Foundation

func debugLog(_ message: String) {
    guard ProcessInfo.processInfo.environment["MUSICVIS_DEBUG"] == "1" else {
        return
    }
    fputs("[AudioCaptureHelper] \(message)\n", stderr)
    fflush(stderr)
}

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let text = String(data: data, encoding: .utf8) else {
        fputs("{\"type\":\"error\",\"message\":\"failed to encode payload\"}\n", stdout)
        return
    }
    fputs("\(text)\n", stdout)
    fflush(stdout)
}

@available(macOS 13.0, *)
func runCapture() {
    debugLog("process started")
    let service = AudioCaptureService()
    service.onMessage = emit

    signal(SIGTERM, SIG_IGN)
    let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    signalSource.setEventHandler {
        debugLog("sigterm received")
        service.stop()
        exit(0)
    }
    signalSource.resume()

    Task {
        await service.start()
    }

    RunLoop.main.run()
}

if #available(macOS 13.0, *) {
    runCapture()
} else {
    emit(["type": "error", "message": "macOS 13 Ventura or newer is required"])
    exit(1)
}
