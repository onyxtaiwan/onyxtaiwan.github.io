/*
 * ONYX 設定檔：設定好 PayPal 和付款 GAS 之後，只需要改這個檔案。
 * index.html（或 preview.html）和 pay.html 都讀這裡。
 * 上傳到 GitHub 後約 10 分鐘生效（GitHub Pages 快取）。
 */
window.ONYX_SETTINGS = {
  // ① 付款 GAS 的網頁應用程式網址（結尾是 /exec）
  PAYMENT_GAS_URL: "",
  // ② PayPal Client ID（測試用 Sandbox，上線換 Live）。Secret 絕對不要放這裡。
  PAYPAL_CLIENT_ID: ""
};
