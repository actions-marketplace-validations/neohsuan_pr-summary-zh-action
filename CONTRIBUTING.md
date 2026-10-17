# 參與貢獻 / Contributing

歡迎提交錯誤修正、測試與文件改善。請在 issue 或 PR 說明問題、預期結果與驗證方式，避免附上私有 diff、API key 或 access token。

使用 Node.js 20 與 npm：

```sh
npm install
npm test
npm run build
npm run check:dist
```

主要程式位於 `src/`，測試位於 `test/`。新增 provider 或調整請求時，請以 mock 驗證 HTTP URL、headers、payload、成功與失敗回應。留言行為須涵蓋新建與更新；測試不可依賴真實服務或 secrets。

修改原始碼或依賴後，請將最新的 `dist/`（含 `licenses.txt`）和 `package-lock.json` 一併納入 PR。執行 bundle 一致性檢查前，先執行 build。CI 會使用 Node.js 20 安裝鎖定依賴、跑測試並確認 bundle 與原始碼一致。

English: Describe the problem and validation in your PR. Use Node.js 20 and npm, keep tests offline with mocked providers and Octokit, and include rebuilt `dist/` plus the lockfile whenever source or dependencies change. Never include credentials or private source material. Contributions are provided under the MIT license.
