# JVM (Java, Kotlin, Spring, Gradle, Maven)

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| Java 25 (LTS) | 25.0.4.1 | GA 2025-09-16. Oracle premier support to 2030-09-30. |
| Java 21 (LTS) | 21.0.12.1 | Oracle premier support to 2028-09-30. |
| Java 17 (LTS) | 17.0.20.1 | Oracle premier support ended 2026-09-30. Other vendors differ. |
| Java 27 | GA 2026-09-15 | Not LTS. Support to 2027-03-31. Next LTS is Java 29 (2027-09-21). |
| Spring Boot | 4.1.1 | 4.1 OSS support to 2027-07-31. 4.0 to 2026-12-31. 3.5 OSS support ended 2026-06-30. |
| Spring Framework | 7.0.9 | 6.2 OSS support ended 2026-06-30. |
| Kotlin | 2.4.21 | 2.4.0 released 2026-07-14. K2 has been the only compiler since 2.0. |
| Gradle | 9.8.1 | 8.14.6 still gets patches. |
| Maven | 3.9.16 | Maven 4 is not GA. Maven Central lists 4.0.0-rc-7 as its latest. |

Java dates are for Oracle JDK. OpenJDK builds from other vendors can differ.

## Version notes
- **Java >= 21**: virtual threads are final. Use `Executors.newVirtualThreadPerTaskExecutor()` or `Thread.ofVirtual()` for blocking work. Do not put virtual threads in a pool. [source](https://openjdk.org/jeps/444)
- **Spring Boot >= 4.0**: it is built on Spring Framework 7 and keeps a Java 17 baseline. It supports Java up to 27 and needs Servlet 6.1 containers (Tomcat 11, Jetty 12.1). Build with Gradle 8.14+ or 9.x, or Maven 3.6.3+. [source](https://raw.githubusercontent.com/spring-projects/spring-boot/4.1.x/documentation/spring-boot-docs/src/docs/antora/modules/ROOT/pages/system-requirements.adoc)
- **Spring Boot >= 4.0**: Jackson 3 is the default (`tools.jackson.*` packages, a `JsonMapper` bean). Do not write new code against `com.fasterxml.jackson.databind.ObjectMapper`. Jackson 2 support is deprecated and will be removed in a later 4.x. [source](https://raw.githubusercontent.com/spring-projects/spring-boot/4.1.x/documentation/spring-boot-docs/src/docs/antora/modules/reference/pages/features/json.adoc)
- **Spring Boot >= 4.0**: in tests use `@MockitoBean` and `@MockitoSpyBean` from Spring Framework, as the Boot testing reference does. Do not reach for `@MockBean` or `@SpyBean` in new tests. [source](https://raw.githubusercontent.com/spring-projects/spring-boot/4.1.x/documentation/spring-boot-docs/src/docs/antora/modules/reference/pages/testing/spring-boot-applications.adoc)
- **Spring Boot < 4.0**: OSS support for 3.5 ended 2026-06-30, so new projects should start on 4.x. Do not upgrade an existing 3.x project unless asked. [source](https://endoflife.date/spring-boot)
- **Kotlin >= 2.0**: the Compose compiler is a Gradle plugin, `org.jetbrains.kotlin.plugin.compose`. [source](https://kotlinlang.org/docs/whatsnew20.html)
- **Kotlin >= 2.3**: with Android Gradle Plugin 9.0 or newer, do not apply the `kotlin-android` plugin. It is a configuration error because AGP has built-in Kotlin support. In Kotlin Multiplatform, Android targets move to the `com.android.kotlin.multiplatform.library` plugin and the `androidTarget` block becomes `android`. [source](https://kotlinlang.org/docs/whatsnew23.html)
- **Kotlin >= 2.4**: context parameters, explicit backing fields and the `@all` meta-target are stable. Collection literals (`["a", "b"]`) and explicit context arguments are still experimental, so do not use them in production code. It works with Gradle 7.6.3 to 9.5.0 and needs AGP 8.5.2 or newer. [source](https://kotlinlang.org/docs/whatsnew24.html)
- **Maven**: Maven 4 has no GA release. Keep the Maven wrapper (`mvnw`) on 3.9.x unless the project already pins a 4.0 release candidate. [source](https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/maven-metadata.xml)

## Default toolchain
- Gradle projects: use the wrapper. `./gradlew build`, `./gradlew test`, `./gradlew check`.
- Maven projects: use the wrapper if present. `./mvnw verify`, `./mvnw test`.
- Formatting and static analysis (Spotless, Checkstyle, ktlint, detekt) run through the same build tool, and only if the project configures them.
- Java toolchain: follow the version in `build.gradle(.kts)` (`java { toolchain { ... } }`) or `maven.compiler.release` in the POM.
