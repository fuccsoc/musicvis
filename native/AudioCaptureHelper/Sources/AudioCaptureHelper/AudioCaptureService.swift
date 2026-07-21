import Foundation
import ScreenCaptureKit
import CoreMedia

@available(macOS 13.0, *)
final class AudioCaptureService: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private var lastEmit: CFAbsoluteTime = 0
    private var lastDebugEmit: CFAbsoluteTime = 0
    private let queue = DispatchQueue(label: "musicvis.audio-capture")
    private let maxEmittedSamples = 2048

    var onMessage: (([String: Any]) -> Void)?

    func start() async {
        debugLog("start requested")
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else {
                debugLog("start failed reason=no-display")
                onMessage?(["type": "error", "message": "No display found"])
                return
            }
            debugLog("display selected id=\(display.displayID)")

            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let configuration = SCStreamConfiguration()
            configuration.capturesAudio = true
            configuration.excludesCurrentProcessAudio = true
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
            configuration.sampleRate = 44_100
            configuration.channelCount = 1

            let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
            self.stream = stream
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            try await stream.startCapture()
            debugLog("capture started")
            onMessage?(["type": "status", "status": "started"])
        } catch {
            debugLog("start failed error=\"\(error.localizedDescription)\"")
            onMessage?(["type": "status", "status": "permission-denied"])
            onMessage?(["type": "error", "message": error.localizedDescription])
        }
    }

    func stop() {
        debugLog("stop requested")
        Task {
            try? await stream?.stopCapture()
            debugLog("capture stopped")
            onMessage?(["type": "status", "status": "stopped"])
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .audio,
              let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let streamBasicDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            debugLog("sample skipped reason=missing-format")
            return
        }

        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            debugLog("sample skipped reason=missing-block-buffer")
            return
        }

        var dataLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &dataLength, dataPointerOut: &dataPointer)
        guard status == noErr, let dataPointer else {
            debugLog("sample skipped reason=data-pointer status=\(status)")
            return
        }

        let sampleCount = Int(dataLength) / MemoryLayout<Float>.size / Int(streamBasicDescription.pointee.mChannelsPerFrame)
        let bufferPointer = UnsafeBufferPointer(start: UnsafeRawPointer(dataPointer).assumingMemoryBound(to: Float.self), count: sampleCount)
        var monoSamples = [Float]()
        monoSamples.reserveCapacity(min(sampleCount, maxEmittedSamples))

        let sampleStride = max(1, (sampleCount + maxEmittedSamples - 1) / maxEmittedSamples)
        for index in stride(from: 0, to: sampleCount, by: sampleStride) {
            monoSamples.append(max(-1, min(1, bufferPointer[index])))
        }

        let now = CFAbsoluteTimeGetCurrent()
        if now - lastEmit < (1.0 / 45.0) {
            return
        }
        lastEmit = now

        if now - lastDebugEmit >= 2.0 {
            lastDebugEmit = now
            debugLog("audio buffer sampleCount=\(sampleCount) emitted=\(monoSamples.count) stride=\(sampleStride) bytes=\(dataLength)")
        }

        let payload = AudioEncoder.makeAudioPayload(samples: monoSamples, timestamp: UInt64(now * 1000))
        onMessage?(payload)
    }

    private func debugLog(_ message: String) {
        guard ProcessInfo.processInfo.environment["MUSICVIS_DEBUG"] == "1" else {
            return
        }
        fputs("[AudioCaptureHelper] \(message)\n", stderr)
        fflush(stderr)
    }
}
