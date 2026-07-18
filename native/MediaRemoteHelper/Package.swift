// swift-tools-version: 5.5
import PackageDescription

let package = Package(
    name: "MediaRemoteHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "MediaRemoteHelper", targets: ["MediaRemoteHelper"])
    ],
    dependencies: [
        .package(url: "https://github.com/ejbills/mediaremote-adapter.git", revision: "cf30c4f1af29b5829d859f088f8dbdf12611a046")
    ],
    targets: [
        .executableTarget(
            name: "MediaRemoteHelper",
            dependencies: [
                .product(name: "MediaRemoteAdapter", package: "mediaremote-adapter")
            ],
            path: "Sources/MediaRemoteHelper"
        )
    ]
)
