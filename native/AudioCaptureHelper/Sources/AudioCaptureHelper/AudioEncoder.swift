import Foundation

enum AudioEncoder {
    static func makeAudioPayload(samples: [Float], timestamp: UInt64) -> [String: Any] {
        [
            "type": "audio",
            "timestamp": timestamp,
            "samples": samples
        ]
    }
}
