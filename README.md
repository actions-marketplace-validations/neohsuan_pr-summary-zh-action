# pr-summary-zh-action

以 LLM 自動閱讀 Pull Request diff，產生 **繁體中文變更摘要與風險提醒**，並建立或更新同一則 PR 留言。支援 OpenAI Chat Completions、Gemini API 與 Vertex AI；以 Node.js 20 執行，使用 ncc 將執行依賴打包至 `dist/`，讓使用者不必安裝 npm 套件。

## 使用方式

在使用此 Action 的儲存庫建立 `.github/workflows/pr-summary.yml`：

```yaml
name: PR 摘要
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: pr-summary-${{ github.event.pull_request.number }}
  cancel-in-progress: false
jobs:
  summary:
    # fork 與 Dependabot PR 不會取得一般 repository secrets，略過。
    if: github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: neohsuan/pr-summary-zh-action@main
        with:
          provider: openai
          model: gpt-4o-mini
          api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          max-diff-chars: '60000'
          language: zh-TW
```

`main` 代表預期的儲存庫分支；部署時請換成已審核的完整 commit SHA。這份專案沒有自動發布版本。Action 直接透過 GitHub API 讀取 diff，不需要 checkout PR 程式碼。模型必須是你的帳戶可用且支援相應 API 的模型，範例名稱可以自行更換。

請先在儲存庫的 Actions secrets 設定 API key，並允許 workflow 取得 `pull-requests: write`。不要把憑證直接寫入 YAML。Fork PR 的一般 `pull_request` workflow 通常沒有 secrets，也沒有留言寫入權限。若自行使用 `pull_request_target`，必須讓 workflow 與 Action 來自受信任版本，且不可 checkout 或執行 PR 提供的程式碼。

## 輸入與輸出

| 輸入 | 預設 | 說明 |
| --- | --- | --- |
| `provider` | `openai` | `openai`、`gemini`、`vertex` |
| `model` | 無，必填 | Provider 的模型 ID；Google 請填 `gemini-…` 形式的短 ID，不含 `models/` |
| `api-key` | 無 | OpenAI 或 Gemini 必填；Vertex 不使用 |
| `github-token` | `${{ github.token }}` | 需可讀取 PR、列出留言及寫入 PR 留言 |
| `max-diff-chars` | `60000` | 正整數，以 Unicode code point 計算，限制送往 LLM 的 diff 字數 |
| `language` | `zh-TW` | 摘要語言；例如 `English`，也會要求翻譯兩個章節標題 |
| `vertex-project` | 無 | Vertex 必填，Google Cloud project ID |
| `vertex-location` | `us-central1` | Vertex 區域或 `global`，須符合模型供應區域 |
| `vertex-access-token` | 無 | OAuth access token；未提供則使用 ADC |

輸出 `comment-id` 是建立或更新的留言 ID。非 PR 事件會略過且不設定輸出。

## Gemini

將範例中的 `with` 改為：

```yaml
with:
  provider: gemini
  model: gemini-2.5-flash
  api-key: ${{ secrets.GEMINI_API_KEY }}
```

使用 `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`，API key 置於 `x-goog-api-key` header。

## Vertex AI

專案需啟用 Vertex AI API、計費，並授予執行身分模型推論權限（例如 `roles/aiplatform.user`）。可以使用短效 OAuth token：

```yaml
with:
  provider: vertex
  model: gemini-2.5-flash
  vertex-project: ${{ vars.GCP_PROJECT_ID }}
  vertex-location: global
  vertex-access-token: ${{ secrets.VERTEX_ACCESS_TOKEN }}
```

Token 會過期，正式環境建議使用 Workload Identity Federation 與 Application Default Credentials（ADC）。以下步驟可取代前述範例的 `steps`，job 另需 `id-token: write` 及 `contents: read`、`pull-requests: write` 權限：

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      ref: ${{ github.event.repository.default_branch }}
      persist-credentials: false
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
      service_account: ${{ vars.GCP_SERVICE_ACCOUNT }}
      create_credentials_file: true
  - uses: neohsuan/pr-summary-zh-action@main
    with:
      provider: vertex
      model: gemini-2.5-flash
      vertex-project: ${{ vars.GCP_PROJECT_ID }}
      vertex-location: global
```

請在 Google Cloud 設定受信任的 repository / workflow 身分條件。`google-auth-library` 從 ADC 取得 cloud-platform scope 的 access token；明確提供的 `vertex-access-token` 優先。區域 endpoint 為 `{location}-aiplatform.googleapis.com`，`global` 使用 `aiplatform.googleapis.com`。

## 行為與限制

- 以 `@actions/github` 取得 PR diff，截取前 N 個字元後才送往 LLM。截斷狀態會加入提示與留言；字數上限不是 token 上限，也不限制 GitHub 下載的 diff 大小。
- 提示要求輸出 `## 變更摘要` 與 `## 風險提醒`。`language` 控制 LLM 內容；截斷通知、頁尾與空 diff 提示仍為繁體中文。空 diff 不呼叫 LLM。
- 使用 `<!-- pr-summary-zh-action -->` marker，分頁搜尋同一 token 身分的既有留言；`GITHUB_TOKEN` 使用 `github-actions[bot]` 身分，PAT 使用 `/user` 回傳的身分。相同內容不重寫。請保留 workflow 的 concurrency 設定以避免同一 PR 同時執行造成重複留言；不同 token 身分不會接管彼此留言。
- 單則留言限制在保守的 60,000 UTF-8 bytes 內，過長會截斷。模型回覆中的 HTML 註解會移除，`@` 後會插入零寬字元以避免意外通知。
- LLM 請求有 120 秒 timeout；網路、HTTP、無內容、遭阻擋或未完整生成的回覆會讓 Action 失敗，不覆蓋現有摘要。不自動重試，避免重複計費。GitHub 大型 diff 下載限制及模型 context window 仍適用。
- Diff 會傳送給所選 provider，可能含私有程式碼或敏感資料；請先確認儲存庫政策。程式不記錄 diff、LLM 回覆或上游錯誤內容，並遮蔽明確輸入的密鑰。
- Diff 以不受信任資料處理，提示要求忽略其中指令。LLM 仍可能誤判或受提示注入影響；摘要不等同完整 code review，請人工驗證。

## 開發

需要 Node.js 20 與 npm：

```sh
npm install
npm test
npm run build
npm run check:dist
```

`npm test` 使用 Vitest mock HTTP providers、Google ADC 與 Octokit，不會呼叫真實服務，也不需要 secrets。CI 使用 Node.js 20 執行 `npm ci`、測試及 bundle 一致性檢查。修改 `src/` 或依賴後須重新產生並納入完整 `dist/`（含第三方授權檔）及 `package-lock.json`；`.gitignore` 刻意保留 `dist/`。

API 參考：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Gemini generateContent](https://ai.google.dev/api/generate-content)、[Vertex generateContent](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/projects.locations.publishers.models/generateContent)、[GitHub Pull Requests](https://docs.github.com/en/rest/pulls/pulls)。

## English

A Node.js 20 GitHub Action that fetches a PR diff, truncates it by Unicode code points, asks an LLM for a Markdown change summary and risk notes, and creates or updates one marker comment. Traditional Chinese (`zh-TW`) is the default; set `language: English` for English model output.

Use the workflow above with `provider`, a supported `model`, and an API key stored in Actions secrets. OpenAI uses Chat Completions; Gemini uses the Generative Language API; Vertex uses `generateContent` with either `vertex-access-token` or ADC via `google-auth-library`. Vertex also requires `vertex-project` and optionally `vertex-location` (`global` is supported).

Grant `pull-requests: write`, keep per-PR concurrency, and skip fork/Dependabot runs that lack credentials. The Action does not execute PR code. Diff data is sent to the configured provider, and generated reviews require human verification. Provider failures preserve the existing comment and fail the run. Run `npm install`, `npm test`, `npm run build`, and `npm run check:dist` to develop; include the generated `dist/` and lockfile when contributing.

Licensed under MIT, copyright 2026 neohsuan.
