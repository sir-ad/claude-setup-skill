# .NET and C#

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| .NET 10 (LTS) | 10.0.12 (2026-09-08) | GA 2025-11-11. EOL 2028-11-14. |
| .NET 9 (STS) | 9.0.20 | EOL 2026-11-10. |
| .NET 8 (LTS) | 8.0.31 | EOL 2026-11-10. |
| .NET 11 | RC1 | Not released. GA expected November 2026. |
| C# | 14 | Ships with .NET 10. C# 15 is in .NET 11 preview and may change. |

## Version notes
- **.NET 8 or 9**: both reach EOL on 2026-11-10. For new projects target `net10.0`. Do not retarget an existing project unless asked. [source](https://endoflife.date/dotnet)
- **.NET 11 / C# 15 preview**: do not use union types, closed hierarchies, extension indexers or labeled `break`/`continue`. They are preview features. [source](https://raw.githubusercontent.com/dotnet/docs/main/docs/csharp/whats-new/csharp-15.md)
- **C# >= 14 (.NET 10)**: the `field` keyword is available in property accessors, so a property with extra logic needs no hand-written backing field. Extension members (extension blocks, including extension properties) are available. Null-conditional assignment (`a?.b = x`) works. [source](https://raw.githubusercontent.com/dotnet/docs/main/docs/csharp/whats-new/csharp-14.md)
- **C# >= 13 (.NET 9)**: `params` accepts collection types, not only arrays. Use `System.Threading.Lock` for `lock` statements instead of locking on an `object`. [source](https://raw.githubusercontent.com/dotnet/docs/main/docs/csharp/whats-new/csharp-13.md)
- **SDK >= 10**: `dotnet new sln` creates a `.slnx` file (XML format). SDK 9 and earlier create `.sln`. `dotnet sln migrate` converts `.sln` to `.slnx`. Commands accept `.sln`, `.slnx` and `.slnf`. [source](https://raw.githubusercontent.com/dotnet/docs/main/docs/core/tools/dotnet-sln.md)
- **SDK >= 10**: `dotnet test` can use Microsoft.Testing.Platform. Enable it with `"test": { "runner": "Microsoft.Testing.Platform" }` in `global.json`. [source](https://raw.githubusercontent.com/dotnet/docs/main/docs/core/whats-new/dotnet-10/sdk.md)
- **SDK >= 10**: `dotnet tool exec` and `dnx` run a tool without installing it. File-based apps run with `dotnet run app.cs`. [source](https://raw.githubusercontent.com/dotnet/docs/main/docs/core/whats-new/dotnet-10/sdk.md)
- **Central Package Management**: if the repo has a `Directory.Packages.props` with `<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>`, put versions in `<PackageVersion Include="X" Version="1.2.3" />` there. Project files then use `<PackageReference Include="X" />` with no `Version` attribute. [source](https://raw.githubusercontent.com/NuGet/docs.microsoft.com-nuget/main/docs/consume-packages/Central-Package-Management.md)
- **ASP.NET Core >= 10 (minimal APIs)**: call `builder.Services.AddValidation()` for built-in DataAnnotations validation of query, header and body values. Failures return 400. Turn it off per endpoint with `DisableValidation()`. [source](https://raw.githubusercontent.com/dotnet/AspNetCore.Docs/main/aspnetcore/release-notes/aspnetcore-10/includes/ValidationSupportMinAPI.md)
- **ASP.NET Core >= 10**: generated OpenAPI documents default to OpenAPI 3.1, where nullable types appear as `type: [x, "null"]`. Set `OpenApiOptions.OpenApiVersion` to change it. [source](https://raw.githubusercontent.com/dotnet/AspNetCore.Docs/main/aspnetcore/release-notes/aspnetcore-10/includes/openApi.md)

## Default toolchain
- Restore and build: `dotnet build`.
- Test: `dotnet test`.
- Format: `dotnet format`, which follows the repo's `.editorconfig`.
- Packages: `dotnet add package <name>` (or edit `Directory.Packages.props` when central management is on).
- Solutions: `.slnx` on SDK 10, `.sln` on older SDKs. Do not convert an existing solution unless asked.
