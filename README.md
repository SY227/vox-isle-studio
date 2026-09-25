# 聲嶼 VOX ISLE · v1.2.0

**先聽全曲 → 先進練歌室 → 只精修需要的部分。**

這次只改分析等待流程，不重新設計介面。保留明亮繁體中文介面、唯一頂部播放列、左側完整歌詞、右側 YouTube 與動畫嚮導、隱藏其他頁籤、沒有封面與開發者設定 UI。原先「每24秒都要再次盲聽，再全部完成才能開始」的主要路徑已替換。

## 更新現有安裝

在舊伺服器 Terminal 按 **Ctrl+C**：

```bash
cd "$HOME/Downloads"
unzip -o vox-isle-studio-v1.2.0.zip
cd vox-isle-studio
npm run dev
```

開啟 `http://localhost:3000`。ZIP 不包含 `.env`，覆蓋安裝保留既有金鑰。請在同一個資料夾更新；全新資料夾不會自動取得舊設定。沒有 npm 執行依賴，不需要 `npm install`。**重新貼上連結並分析一次**才能使用新流程；舊的 JSON 不會自行改善時間軸。

可先備份（備份含私人設定，不要分享）：

```bash
cd "$HOME/Downloads"
cp -a vox-isle-studio "vox-isle-studio-backup-$(date +%Y%m%d-%H%M%S)"
```

確認正在跑新版本：

```bash
curl -sI http://localhost:3000 | grep -i x-vox-build
```

應顯示 `X-Vox-Build: 1.2.0`。若仍看到舊版，停止舊伺服器再啟動；不要同時開兩個 port 3000。

## 新流程

**首輪：聽整個來源。** 一次錄音優先請求產生歌詞、樂句時間、可辨認的逐字時間、語言、長度、首輪可信度和可辨認的音域。沒有先行24秒概覽循環，不計算每一句長篇教學，也不要求先準備歌詞。第一份可用結果驗收後，後端立即傳送 `ready`，前端立刻展開練歌室。未取得音高時顯示待確認，不編造數字。

**邊播邊精修。** 高可信且無結構問題的句子不額外核對時間；其他句子依風險排列，使用該句前後各2秒的小片段。最多安排全曲30%且最多12句的時間核對；更深入複聽最多全曲10%且最多3句。這些是成本上限，不是「70–85%必定準確」或效果保證。未知逐字邊界、重疊、疑似聽不清、過長句子可推翻模型的高可信自評。

真聲／混聲／頭聲／假聲、音高、轉音、換氣等標記分批加入。每批最多8句／120字；未完成顯示「分析中」。完整歌詞一直保留在頁面。進度表示實際已處理的工作項目，不是AI猜測的百分比。暫停精修後未完成標記改成「待補上」。

**點了才深入教學。** 使用者主動點字才為那一句請求详细咬字、練法、母音與聲樂建議。自動跟唱選取不觸發付費教學請求。同一句快取於目前頁面；切換另一句取消舊的未完成請求，避免快速點擊造成大量請求。

**第8批失敗也不清空。** 任何首輪之後的片段失敗、連線中斷、逾時或取消，都保留已顯示歌詞、標記、播放器和進度。完成狀態誠實標為部分完成／已暫停，不冒充全部完成。真正首輪無結果的錯誤仍會顯示，不能用假示範冒充分析。

## 播放、同步與不確定性

進度更新只修改歌詞／教學／統計節點，不重建、移動或重新載入 YouTube iframe，不呼叫第二次 `activate`。原片 Play、Pause、seek、倍速、上方播放列繼續共用原來的媒體時鐘。

沒有逐字邊界時只做樂句同步，不按字數平均分秒。模型自評可信度只是安排優先順序，**不是已校準的準確率**。較少複聽降低等待，但可能留下更不確定的時間。此版沒有聲稱已量測真實歌曲的同步精度改善。唱法是可嘗試的教學建議，不是原唱聲帶生理狀態的已確認分類。

手動校正不會被後續精修覆蓋。若手動修改時間導致句子順序改變，系統停止這次精修，保留編輯，避免把舊 occurrence ID 的結果套到錯誤句子。

## 請求與成本界線

預設全工作室最多3個同時執行的provider工作，包含精修和按需教學。原有暫時性連線／429／5xx失敗，在原始嘗試後最多靜默重試3次；取消會中止重試。永久認證與權限错误不進行同樣重試。

首輪工作流程不再等待後續驗證或教學。實際首輪仍受影片長度、來源存取、模型輸出與API負載影響，**沒有5秒完成保證**。相容路徑和重試可能增加HTTP請求與用量。原有YouTube輸入相容路徑保留，不能保證所有影片都能讀取／嵌入。

整個分析工作deadline15分鐘，單次HTTP嘗試最多75秒。YouTube最多15分鐘單曲，音訊上傳仍限6分鐘／50MB。規模上限600句／8000字。首輪無法確認完整內容時會在品質資訊告知；不得把部分內容宣稱完整。

## 首次執行：開發者設定

需要 Node.js 22+。金鑰只在本機後端 `.env`；不要提供給聊天或前端。

```bash
npm run setup
npm run check:api
npm run dev
```

預設後端模型維持 `gemini-3.8-flash`，未更換模型。`check:api` 是模型存取檢查，不是歌曲精度驗證。没有設定時仍能體驗原創示範。新的「逐步精修」不需要新增金鑰、資料庫、Python模型或第三方npm套件。

## QA與真實連結

見 `docs/QA_REPORT.md`。本機測試透過明確標示的AI／YouTube替身驗證流程；原生媒體測試實際播放內建原創WAV，不是商業歌曲。

```bash
npm test
npm run check
```

瀏覽器開發QA額外需要 Python Playwright 與 Chromium（非App執行依賴）：

```bash
node tests/fixtures/build-adaptive-cases.mjs
CHROMIUM_PATH=/path/to/chromium python tests/ui_adaptive.py
CHROMIUM_PATH=/path/to/chromium python tests/ui_smoke.py
CHROMIUM_PATH=/path/to/chromium python tests/ui_regression.py
CHROMIUM_PATH=/path/to/chromium python tests/ui_listening.py
CHROMIUM_PATH=/path/to/chromium python tests/ui_native_media.py
```

使用本機金鑰、真實Chrome依序驗收使用者兩條影片連結（產生真實API用量）：

```bash
npm run verify:links
```

單支影片：

```bash
npm run verify:live -- "https://www.youtube.com/watch?v=YaJ_lYFgr6c&list=RDeV9a5oUCbZQ&index=2"
```

`test-results/live-links/`保存每支獨立結果。這次交付環境無法解析YouTube／Google API且沒有本機金鑰，兩支均記錄為 **blocked，不是passed**。即使在使用者機器傳輸測試passed，仍不是逐字聽辨精度認證；需與人工確認的原聲时间對照。

## 部署

預設只監聽127.0.0.1。公開部署需HTTPS `APP_ORIGIN`、強`APP_ACCESS_CODE`、API配額保護和真實裝置驗收。此版分析／按需快取存在頁面記憶體，非持久化背景服務；關頁會取消工作。伺服器不持久保存音訊或歌詞；外部AI資料政策以API專案條款為準。
