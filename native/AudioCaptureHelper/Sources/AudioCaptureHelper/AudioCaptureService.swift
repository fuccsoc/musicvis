import Foundation
import ScreenCaptureKit
import CoreMedia

@available(macOS 13.0, *)
final class AudioCaptureService: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private var lastEmit: CFAbsoluteTime = 0
    private let queue = DispatchQueue(label: "musicvis.audio-capture")

    var onMessage: (([String: Any]) -> Void)?

    func start() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else {
                onMessage?(["type": "error", "message": "No display found"])
                return
            }

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
            onMessage?(["type": "status", "status": "started"])
        } catch {
            onMessage?(["type": "status", "status": "permission-denied"])
            onMessage?(["type": "error", "message": error.localizedDescription])
        }
    }

    func stop() {
        Task {
            try? await stream?.stopCapture()
            onMessage?(["type": "status", "status": "stopped"])
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .audio,
              let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let streamBasicDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            return
        }

        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            return
        }

        var dataLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &dataLength, dataPointerOut: &dataPointer)
        guard status == noErr, let dataPointer else {
            return
        }

        let sampleCount = Int(dataLength) / MemoryLayout<Float>.size / Int(streamBasicDescription.pointee.mChannelsPerFrame)
        let bufferPointer = UnsafeBufferPointer(start: UnsafeRawPointer(dataPointer).assumingMemoryBound(to: Float.self), count: sampleCount)
        var monoSamples = [Float]()
        monoSamples.reserveCapacity(min(sampleCount, 512))

        let sampleStride = max(1, sampleCount / 512)
        for index in stride(from: 0, to: sampleCount, by: sampleStride) {
            monoSamples.append(max(-1, min(1, bufferPointer[index])))
        }

        let now = CFAbsoluteTimeGetCurrent()
        if now - lastEmit < (1.0 / 45.0) {
            return
        }
        lastEmit = now

        let payload = AudioEncoder.makeAudioPayload(samples: monoSamples, timestamp: UInt64(now * 1000))
        onMessage?(payload)
    }
}
