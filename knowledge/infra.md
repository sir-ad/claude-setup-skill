# Infra (Terraform, OpenTofu, Docker Compose)

Checked: 2026-10. The project's pinned versions always win over this file.

## Current versions
| Tool | Latest stable | Support notes |
|---|---|---|
| Terraform | 1.16.5 | 1.16.0 was released 2026-08-26. A 1.17.0 release candidate exists. Business Source License since 1.6. |
| OpenTofu | 1.13.1 | 1.13 supported to 2027-08-01, 1.12 to 2027-02-01. Open-governance fork of Terraform. |
| Docker Engine | 29.9.0 | 28.x reached EOL 2026-05-13. |
| Docker Compose | v2 / v5 | Both are supported Go CLIs. v5 is functionally the same as v2. |

## Version notes
- **Terraform vs OpenTofu**: use whichever CLI the repo already uses (look for `terraform` or `tofu` in CI files, Makefiles and READMEs). Do not swap one for the other. Terraform has been under the Business Source License since 1.6; OpenTofu is the open fork. [source](https://raw.githubusercontent.com/hashicorp/terraform/main/LICENSE)
- **OpenTofu >= 1.13**: the provisioner `winrm` connection type is removed, and the output of `base64gzip` changed. Check configs that use either before upgrading. [source](https://raw.githubusercontent.com/opentofu/opentofu/main/CHANGELOG.md)
- **Compose (any current)**: run `docker compose`, not the legacy Python `docker-compose` v1. [source](https://raw.githubusercontent.com/docker/docs/main/content/manuals/compose/intro/history.md)
- **Compose (any current)**: do not add a top-level `version:` key to a Compose file. It is obsolete and ignored with a warning. [source](https://raw.githubusercontent.com/docker/docs/main/content/reference/compose-file/version-and-name.md)
- **Compose (any current)**: name new files `compose.yaml`. `compose.yml`, `docker-compose.yaml` and `docker-compose.yml` still load, and `compose.yaml` wins if both exist. Keep an existing file's name. [source](https://raw.githubusercontent.com/docker/docs/main/content/manuals/compose/intro/compose-application-model.md)

## Default toolchain
- Terraform or OpenTofu: `terraform fmt -check`, `terraform validate`, `terraform plan` (use `tofu` in OpenTofu repos). Never run `apply` or `destroy` without being asked.
- Compose: `docker compose config` to validate, `docker compose up -d` to start, `docker compose logs <service>` to read output.
