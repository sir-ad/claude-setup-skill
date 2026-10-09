# Mobile (Swift, Android, Flutter)

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| Swift | 6.4.0 (2026-09-14) | Ships with Xcode 27.0. 6.3 (2026-03-24) added an official Android SDK. |
| Android Gradle Plugin | 9.4.0 | Needs Gradle 9.6.0+, JDK 17, SDK Build Tools 36.0.0. Max API level 37. |
| Flutter | 3.47.7 | Stable channel. Ships with Dart 3.13.5. |
| Dart | 3.13.5 | |

Kotlin and Gradle notes for Android projects are in `jvm.md`.

## Version notes
- **Swift language mode 6**: data races are compile errors. Before switching a package to Swift 6 mode, turn on `-strict-concurrency=complete` to see them as warnings first. [source](https://www.swift.org/blog/announcing-swift-6/)
- **Swift >= 6.0**: typed throws are available (`throws(MyError)`). The `Synchronization` module provides `Mutex` and atomics, and Swift Testing is the newer test framework. [source](https://www.swift.org/blog/announcing-swift-6/)
- **Swift >= 6.2**: default main-actor isolation is opt-in (`-default-isolation MainActor`). An upcoming feature makes nonisolated async functions run in the caller's execution context. Do not turn either on in a project that has not adopted them. [source](https://www.swift.org/blog/swift-6.2-released/)
- **Swift >= 5.9 (SwiftUI)**: use the `@Observable` macro (Observation module) for model classes, not `ObservableObject` with `@Published`. [source](https://raw.githubusercontent.com/swiftlang/swift-evolution/main/proposals/0395-observability.md)
- **Swift >= 6.4**: SwiftPM builds with Swift Build by default. XCTest and Swift Testing can interoperate in one test target. [source](https://www.swift.org/blog/swift-6.4-released/)
- **Android Gradle Plugin >= 9.0**: Kotlin support is built in. Do not apply the `kotlin-android` plugin. [source](https://kotlinlang.org/docs/whatsnew23.html)
- **Android Gradle Plugin >= 9.4**: needs Gradle 9.6.0 or newer and JDK 17. AGP 10 will make the new Variant API mandatory; until then a module can opt out with `android.newDsl.optOut`. Add the opt-out only if the build breaks. [source](https://developer.android.com/build/releases/gradle-plugin)
- **Dart >= 3.10**: dot shorthands are available (`Color c = .blue;`). [source](https://raw.githubusercontent.com/dart-lang/sdk/main/CHANGELOG.md)
- **Dart >= 3.13**: primary constructors are available (`class Point(var int x, var int y);`). They need `sdk: ^3.13.0` in `pubspec.yaml`. Do not use them if the SDK constraint is lower. [source](https://raw.githubusercontent.com/dart-lang/sdk/main/CHANGELOG.md)

## Default toolchain
- Swift packages: `swift build`, `swift test`.
- Android: `./gradlew test`.
- Flutter: `flutter pub get`, `flutter test`, `flutter analyze`, `dart format .`.
