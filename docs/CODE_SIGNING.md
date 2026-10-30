# 代码签名：选型、接线与发布门槛

状态：决策文档 + 接线手册。证书采购与路线拍板归发布负责人；本文不引入证书、不改打包行为。当前事实：`apps/desktop/electron-builder.yml` 的 `win.signAndEditExecutable: false`，安装包未签名——Windows SmartScreen 显示"未知发布者"，安装被拦需"仍要运行"。

## 1. 路线对比（2026-10 现实）

| 路线 | 成本 | SmartScreen | 硬件令牌 | CI 自动签名 | 适用 |
| --- | --- | --- | --- | --- | --- |
| **自签名**（本地生成） | ¥0 | 仍警告；仅导入根证书的机器显示身份 | 不需要 | 可（PFX 经 secret） | 内部测试、签名管线演练；**不能消除外部用户警告** |
| **OV 代码签名** | 约 ¥1–3k/年 | 初期仍可能警告，信誉逐步积累 | **强制**（私钥必须 USB 令牌/HSM，2023-06 起 CA/B 论坛基线） | 受限：令牌须插在签名机上，或经 Windows 证书存储 | 有组织身份、可接受手动签名 |
| **EV 代码签名** | 约 ¥3–8k/年 | 即时信誉（不出现未知发布者警告） | **强制** | 同上受限 | **需企业实体**（CA 组织验证）；个人开发者不可选 |
| **Azure Trusted Signing** | 约 $9.99/月起 | 与 OV 同级（信誉逐步积累） | **不需要**（微软托管密钥） | **原生友好**：electron-builder `azureSignOptions` + Entra 应用凭证 | 个人或组织均可（需身份验证）；当前对"个人开发者 + GitHub Actions"最顺 |

结论建议：**短期**用自签名把签名管线演练通（今天就能做、零成本）；**对外分发**在 Azure Trusted Signing（推荐，无令牌、CI 原生）与 OV 证书（愿意手动插令牌）之间拍板；EV 仅在以企业实体发布时考虑。

## 2. 接线手册

### 2.1 electron-builder（PFX 文件 / 证书存储，OV-EV-自签名通用）

electron-builder 读标准环境变量，无需改 yml 结构：

- `CSC_LINK`：PFX 路径（`file://` 或 base64 data URL）；
- `CSC_KEY_PASSWORD`：PFX 口令。

启用签名还必须把 `win.signAndEditExecutable` 置 `true`（当前为 `false`，该开关同时控制 rcedit 元数据编辑——启用属签名时的一次性行为变更，记入发布检查单）。产物验证：`Get-AuthenticodeSignature <installer>.exe` 应为 Valid；`signtool verify /pa /v <installer>.exe`。

### 2.2 Azure Trusted Signing（electron-builder 原生）

`win` 配置追加 `azureSignOptions`（`publisherName` / `endpoint` / `codeSigningAccountName`），凭证走环境变量 `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`。此路线不需要 `CSC_LINK`，与 CI 兼容最好。

### 2.3 自签名本地演练（PowerShell，今天即可执行）

```powershell
# 1) 生成代码签名证书（当前用户存储）
New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=DeepSeek Bot Dev" `
  -CertStoreLocation Cert:\CurrentUser\My
# 2) 导出 PFX（记下口令；PFX 与口令不进仓库）
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object -First 1
Export-PfxCertificate -Cert $cert -FilePath D:\keys\dsb-dev.pfx -Password (ConvertTo-SecureString "<口令>" -AsPlainText -Force)
# 3) 签名演练（SDK signtool；/tr 必须加 RFC3161 时间戳，否则证书过期后签名失效）
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
  /f D:\keys\dsb-dev.pfx /p "<口令>" "apps\desktop\release\DeepSeek Bot-<version>-x64.exe"
```

或走 electron-builder：设 `CSC_LINK=file://D:/keys/dsb-dev.pfx`、`CSC_KEY_PASSWORD=<口令>` 后 `pack:win`。

## 3. 密钥红线与 CI

- PFX、口令、Entra secret **一律不进仓库**：本机走环境变量，CI 走 GitHub Secrets（`CSC_LINK`/`CSC_KEY_PASSWORD` 或 Azure 三元组），`.github/workflows/package.yml` 引用 env 时的改动随启用签名的 PR 单独评审。
- 时间戳（RFC3161）是发布签名必选项；自签名演练也建议带，保持管线一致。
- 签名产物仍按 RELEASE.md §3 要求附 SHA-256 与验证输出。

## 4. 拍板清单（负责人勾选后由对应 PR 落地）

- [ ] 路线：Azure Trusted Signing / OV / EV / 暂维持未签名（如实标注）；
- [ ] 采购与身份验证（个人 or 组织）；
- [ ] 启用 PR：`signAndEditExecutable` 置 true + 路线对应配置 + CI secrets 接线 + 干净机验证 SmartScreen 表现并截图归档。
