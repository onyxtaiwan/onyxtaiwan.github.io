/*
 * ONYX 設定檔：網站只需要改這個檔案。
 * index.html（或 preview.html）和 pay.html 都讀這裡。
 * 上傳到 GitHub 後約 10 分鐘生效（GitHub Pages 快取）。
 */
window.ONYX_SETTINGS = {
  // ① 新訂單試算表 GAS 的網頁應用程式網址（結尾是 /exec）：訂單、優惠碼、付款都走這個網址
  GAS_URL: "https://script.google.com/macros/s/AKfycbyGD7ziPlO3d-0fjr2hxuXdEjdT88-n2k8oJW9AYgcPMj91Q_BrXYML54WQMJeXeMTAjA/exec",
  // ② 線上付訂金（PayPal）：false = 關閉，客人送出後由你確認行程、手動傳訂金連結；true = 開啟（GAS 的 ONLINE_PAYMENT 也要設成 on）
  ONLINE_PAYMENT: false,
  // ③ PayPal Client ID（ONLINE_PAYMENT 為 true 才需要；測試用 Sandbox，上線換 Live）。Secret 絕對不要放這裡。
  PAYPAL_CLIENT_ID: "",
  // ④ Google Analytics 4 評估 ID（G- 開頭）；空白 = 不統計。歐洲時區的客人會先看到同意提示
  GA_ID: "",
  // ⑤ 行程結束意見調查（survey.html）的 GAS 網址（另一份「ONYX 意見調查」試算表，結尾是 /exec）
  SURVEY_GAS_URL: ""
};
