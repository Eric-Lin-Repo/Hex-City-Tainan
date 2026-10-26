# data/i18n：英文與日文翻譯資料

HEX CITY 台南的介面與資料翻譯檔。原始資料（`data/*.json`、`index.html`、`app.js`、`calendar-panel.js`）維持繁體中文不變；這個資料夾只放翻譯對照，由 i18n 切換程式在執行期套用。

## 檔案

| 檔案 | 內容 |
| --- | --- |
| `ui.zh.json` | 介面字串對照表：`key → 中文原文`。這是從 `index.html`、`app.js`、`calendar-panel.js`（另含 `calendar.js`、`weather.js`、`bus.js` 幾個使用者看得到的字串）整理出來的，用來把程式裡的字串換成 key。 |
| `ui.en.json` / `ui.ja.json` | 同樣的 key，英文與日文。 |
| `data.en.json` / `data.ja.json` | 資料檔的翻譯，依 id 對照。 |

### `ui.*.json` 的 key 命名

短英文蛇形命名，用 `.` 分群：`btn.*`（工具列按鈕）、`toggle.*`（HUD 開關）、`time.*`（時段按鈕）、`card.*`（卡片統計欄位）、`section.*`（卡片小標）、`pin.*`、`walker.*`、`station.*`、`event.*`、`poi.*`、`bus.*`、`trail.*`、`tree.*`（側欄清單）、`toast.*`、`tour.*`、`cal.*`（月曆面板）、`lunar.*` / `fmt.*`（`calendar.js`）、`weather.*`。`*.title` 是按鈕的 `title` 屬性，`*.aria` 是 `aria-label`。

動態組合的字串用 `{name}` 佔位符記錄，例如 `card.population.value` = `約 {n} 千人`、`walker.status.moving` = `從 {from} 前往 {dest}`。套用時請自行替換佔位符；英文有些值刻意不含單位（`card.walkers.value` = `{n}`），因為欄位名已說明。

幾個刻意保留中文、不應翻譯的 key：`maplink.city`（`台南市`）、`maplink.station_suffix`（`車站`）、`maplink.hsr_suffix`（`站`）——它們只用來組 Google Maps 的搜尋字串，翻譯會讓搜尋失準。搜尋別名（`tree.search.*`）在各語言是該語言的關鍵字，不是逐字翻譯。

### `data.*.json` 的結構

```
{
  "districts":        { "<district id>": { "name", "summary" } },        // 37
  "buildings":        { "<building id>": { "name", "desc" } },           // 136；desc 對應 islands.json 的 `plain` 欄位
  "pois":             { "<poi id>": { "name", "desc" } },                // 33
  "events":           { "<event id>": { "name", "when", "desc", "labels"? } }, // 23；labels 是多段排程的 label（去程/回程、跨年/迎春），依 schedule 陣列順序
  "stations":         { "<station id>": { "name" } },                    // 17
  "lines":            { "<line id | service id>": { "name" } },          // rail.json 的 lines（main、shalun、hsr-0…hsr-21）與 services（houbi-shalun）
  "roles":            { "<role key>": "label" },                         // roles.json 的 label
  "roleDescriptions": { "<role key>": "description" },                   // roles.json 的 description（行人卡片會顯示）
  "dayCycle":         [ { "label", "note" } ],                           // 依 settings.json dayCycle 順序
  "tours":            { "<tour id>": { "name", "blurb", "captions": [ … ] } }, // captions 依 cue 順序
  "crops":            { "<crop key>": { "name", "stages": [ … ] } },     // stages 依 crops.json 順序
  "flows":            { "<flow id>": "text" }                            // flows.json 的 text（卡片的跨區動線說明）
}
```

`id` 全部與原始資料檔一致；`tools/test_i18n.py` 會檢查 id 集合、筆數、空字串與 ui key 集合。日期欄位（`schedule`、`days`、`from`/`to`）不在翻譯檔裡，程式直接沿用原始資料。

注意 `app.js` 的 `PERIOD_BTN` 是用 dayCycle 的中文 `label` 當 key 對應時段按鈕，切換語言時要改成用索引或 `from`/`to` 對應，不要拿翻譯後的 label 去查。

## 翻譯方式

全部為機器翻譯（LLM 產生），**未經母語者審校**。原則是忠於原文、長度相近、不加料；說明文的數字、年份與出處一律照原文。日文說明文用「です・ます」體。

## 地名英譯原則

- 景點用官方或通行的英譯：Anping Old Fort、Chihkan Tower、Tainan Confucius Temple、Eternal Golden Castle、Hayashi Department Store、Sicao Green Tunnel、Qigu Salt Mountain、Nankunshen Daitian Temple、Wushantou Reservoir、Zengwen Reservoir、Guanziling Hot Spring、Yanshui Beehive Fireworks、Southern Taiwan Science Park、Tainan Station、HSR Tainan Station 等。
- 區名用「Yongkang District」格式，拼法以路牌常見者為準（混用通用拼音與漢語拼音）：Annan、Anping、East、West Central、North、South、Yongkang、Rende、Guiren、Guanmiao、Longci、Zuojhen、Sinhua、Shanhua、Sinshih、Anding、Shanshang、Yujing、Nanxi、Nanhua、Danei、Madou、Jiali、Xigang、Qigu、Jiangjun、Xuejia、Beimen、Xinying、Houbi、Baihe、Dongshan、Liuying、Liujia、Guantian、Xiaying、Yanshui。
- 車站名沿用台鐵英譯（Xinshi、Bao'an、Chang Jung Christian University 等），區名與站名因此可能拼法不同（新市區 Sinshih District／新市站 Xinshi）。
- 廟宇：有通行英譯的用通行譯名（Grand Matsu Temple、Sacrificial Rites Martial Temple、Nankunshen Daitian Temple），其餘用拼音＋Temple；神祇名用拼音（Mazu、Guan Yu、Baosheng Dadi、Xuantian Shangdi、Wangye、Qiansui）。
- 其他沒有通行英譯的地點用漢語拼音加通名（Deyuanpi Holland Village、Jingpupi Bald Cypress Grove）。

## 日文地名原則

- 地名與專有名詞用漢字直書，依日文常用字體寫新字體（新営、仁徳、塩水、関廟、帰仁、学甲、将軍、大内、曽文、台湾），沒有新字體的字保留原字（菁寮、噍吧哖、蕭壠、鯤鯓）。
- 日文讀者不熟的概念加括號說明：蜂炮（ハチの巣花火）、蜈蚣陣（ムカデ陣）、菱角（ヒシ）、五分車（製糖用の軽便鉄道）、烏脚病（黒脚病）。
- 外來語與生物名用片假名：ゼーランディア城、プロヴィンティア城、クロツラヘラサギ、レンカク、ラクウショウ、マンゴー、アボカド。
- 「水庫」譯為「ダム」，「老街」保留「老街」，「夜市」保留「夜市」，「廟」保留「廟」（日文漢字）。
