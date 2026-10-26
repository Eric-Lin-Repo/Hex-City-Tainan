# HEX CITY 台南

用資料驅動的互動城市，島是台南 37 個行政區的真實輪廓。純靜態、無建置工具，Three.js r160 由 CDN 透過 importmap 載入。

## 執行

```bash
cd ~/hex-city-demo
python3 -I tools/serve.py 8787   # 不快取的開發伺服器；也可以用 python3 -m http.server 8787
# 打開 http://127.0.0.1:8787/
```

必須用 HTTP 伺服器，直接雙擊 index.html 會因為 ES Module 與 fetch 的同源限制而失敗。

## 檔案

| 檔案 | 角色 |
|---|---|
| `data/city.json` | 37 區的輪廓、區中心、建築與樹的落點、橋的位置。由前處理腳本產生，不手改。 |
| `data/islands.json` | 各區的名稱、顏色、說明與建築內容。 |
| `data/flows.json` | 跨島動線。 |
| `data/rail.json` | 車站與路線（世界座標，由腳本從 `tools/rail_source.json` 投影並貼回陸地）。 |
| `data/poi.json` | 景點、夜市、科學園區（世界座標，由腳本從 `tools/poi_source.json` 投影並貼回陸地）。 |
| `data/events.json` | 民俗活動（由腳本從 `tools/events_source.json` 綁定到景點或建築的位置）。 |
| `data/water_mrt.json` | 河流折線、水庫與潟湖多邊形（世界座標，從 `tools/raw/osm_water.json` 轉出）。 |
| `data/roles.json` | 身分的名稱與說明、隨機姓名用的姓與名。 |
| `data/settings.json` | 總人數 `population`、每條動線的行人數 `flowWalkersPerFlow`、一天的時段 `dayCycle`。 |
| `app.js` | 主控：渲染器、相機、點選、側欄、卡片、時間控制。 |
| `world.js` | 行政區輪廓擠出成島、橋、鄰接圖與路線、區內空地判斷。 |
| `models.js` | 21 種程序化建築模型，每種是一段「擺積木」的程式。 |
| `kit.js` | 零件庫，同種幾何合併成一個 InstancedMesh。 |
| `events.js` | 民俗活動的動態效果：蜂炮粒子、燒王船的火焰與煙、繞廟前進的蜈蚣陣。 |
| `train.js` | 火車：沿路線在站與站之間行駛，每站停靠，終點折返，深夜停駛。 |
| `people.js` | 數百個 Q 版行人，每種身體零件一個 InstancedMesh。動線行人在兩島間來回，漫步者隨機挑目的地或在廣場散步。 |
| `environment.js` | 天空、光、霧、水，用分鐘數在關鍵影格間插值。 |

## 邊界資料來源

`data/city.json`、`data/islands.json`、`data/flows.json` 由 g0v 社群的 [twgeojson](https://github.com/g0v/twgeojson)（CC0）`twTown1982.topo.json` 轉出，原始資料是內政部 1982 版鄉鎮市區界線。原台南市 6 區加原台南縣 31 鄉鎮市，鄉鎮市改稱區，對應 2010 年合併後的 37 區。轉換腳本在 `tools/build_city.py`，用法：

```bash
python3 -I tools/build_city.py <twTown1982.topo.json> data
```

步驟：解碼 TopoJSON、篩出台南、投影（北為 −z，南北約 44 單位）、Douglas-Peucker 簡化、各區沿真實邊界貼合（`INSET = 0`，每條邊界弧線只簡化一次，相鄰的區共用同一結果所以交界完全密合；交界留一條淺溝當區界）、以共用邊界判斷相鄰並算行人跨區點（不再畫橋）、以隨機取樣放建築與樹。建築內容由腳本內的產生器依區的面積配置，動線從相鄰的區挑 7 對。

## 地理編碼、鐵路路徑、水域與測試

- **地理編碼**：`tools/fetch_geocode.py` 用 Nominatim 查車站、景點與各區建築，結果存在 `tools/geocode_cache.json`（key 是 `station:<id>`、`poi:<id>`、`building:<區>:<名>`，`confidence` 為 `district-match`／`bbox`／`bbox-only`／`none`）。`build_city.py` 的採用規則：景點要 `district-match` 或 `bbox`、落在預期的區（來源沒寫區就任一區）內，而且離手寫座標 3 公里內或回傳名稱以景點名開頭，否則保留 `poi_source.json` 的座標；建築要 `district-match` 且落在該區內，才放在真實位置（貼回陸地、離其他點至少 0.6、避開軌道），否則用隨機落點；市區四區（面積小於 `SMALL_AREA`）放完後再用 `relax()` 把建築、景點、車站彼此推開到至少 `SMALL_GAP`（0.65），模型最大 0.58 倍，並依離最近鄰居的距離個別再縮（`world.js` 的 `fitScale`，下限 0.4），讓屋簷不相碰、各區大小不變；選取這些縮小過的建築或景點時鏡頭依比例飛得更近，焦點在市區時最近距離從 3 放寬到 1.6。景點與建築名牌每 0.25 秒做一次防重疊（`app.js` 的 `declutter`）：區名、車站、活動一定顯示，其餘依「選取中 → 景點 → 夜市 → 園區 → 建築」與離焦點遠近排序，重疊的加 `.clutter` 隱藏，中距離也因此能顯示景點名牌；行人走進市區四區會依該區建築的平均縮放跟著縮（`world.zoneScale`，中西區約 ×0.65），每半秒查一次所在的區、比例慢慢過渡，腳本會印出每區剩下太近的組數與最大偏移；車站只拿地理編碼點找最近的軌道節點。`data/poi.json` 與 `data/islands.json` 的每一筆都有 `geocoded` 欄位，腳本會印出採用與保留的數量。
- **鐵路路徑**：從 `tools/raw/osm_rail.json` 取台鐵正線（`railway=rail`、`usage` 為 main／branch、營運者含臺灣鐵路或名稱含縱貫／沙崙／正線／橋，排除站場與側線），節點座標四捨五入到 0.0001 度讓雙軌與河橋的端點接起來，站與站之間用 Dijkstra 沿真實軌道走，再以 Douglas-Peucker（0.03）簡化並補點到每段不超過 0.3 單位。若某對車站在圖上不連通會印 `WARN rail` 並改用直線。
- **水域**：河流取 `waterway=river/canal` 的同名 way 接成折線；水庫與潟湖取 `natural=water` 名稱含清單名的 way 或 relation（relation 的 outer 成員接成環），封閉環拆成兩段簡化以免退化。
- **測試**：`python3 -I tools/test_build.py` 或 `python3 -m unittest tools/test_build.py`（從專案根目錄執行）。會把管線跑進暫存資料夾，檢查 37 區、車站／景點／活動都在島上、建築數不超過落點數、橋只連相鄰區、直通車 17 站依序停靠且路線點超過 100、景點彼此距離不小於 0.5、主要水庫都有多邊形、沒有東西落在湖裡、曾文示意湖與四座壩的位置。`-I` 會把工作目錄從 `sys.path` 拿掉，所以 `python3 -I -m unittest tools/test_build.py` 這種寫法不能用。

## 改內容

- 各區的建築清單在 `tools/buildings_source.json`（37 區共 125 處真實存在的建築與場所，依既有知識整理），格式是 `[名稱, 模型, 一句說明]`；沒有列在裡面的區才由產生器配置。重跑腳本會覆蓋 `islands.json` 與 `flows.json`，所以要改內容請改這份來源檔。
- 市中心的小區（面積小於 6 單位）放建築時間距會自動放寬；放不下的會印出 WARN 並略過。
- 要調整落點、水道寬度或比例，改腳本頂端的常數重新產生。

## 鐵路

- 站點來源在 `tools/rail_source.json`，是經緯度的近似值（誤差約 1 公里），可自行修正後重跑腳本。台鐵縱貫線 15 站加沙崙線 2 站，沙崙站與高鐵台南站合併為一站。
- 有 `tools/raw/osm_rail.json` 時車站會落在最近的真實軌道節點上（軌道沿區界走時改挑附近在陸地上的節點），路線沿 OSM 軌道走；沒有時才把站點貼回陸地、相鄰站太近時沿線推開。建築與樹都會避開軌道。
- 火車依 `tools/rail_source.json` 的 `services` 行駛：目前一條「後壁—沙崙直通車」，兩列車從兩端對開，每站停靠、到終點折返。`lines` 只決定鐵軌怎麼畫。
- 車站可點，卡片顯示路線、所在區與相鄰站；側欄最後一節是「火車站」。
- 除錯：`window.hexcity.trains.state()` 可以看每列車的位置。

## 景點、夜市、科學園區

- 清單來自網路（來源連結記在 `tools/poi_source.json` 每一筆），經緯度是近似值（誤差約 1 公里），可修正後重跑腳本。
- 20 處景點、6 處夜市、南科 4 個區塊。夜市依營業日運作：當天營業的有燈籠與招牌，夜晚行人會聚集；休市的只剩空攤位。星期取自瀏覽器日期，可用 `?day=5` 這類參數模擬（0 是週日）。
- 白天行人有三成五機率往景點走，夜晚有五成五機率往營業中的夜市走。
- 科學園區用圍籬與門牌框住所有園區點。
- 側欄有「景點」「夜市」「科學園區」三節，卡片附來源連結。

## 民俗活動

- 來源在 `tools/events_source.json`，每個活動用 `at` 綁定一個景點 id 或某區的建築名稱，腳本會解析成座標。
- 目前 23 個。香科與民俗：鹽水蜂炮、西港刈香燒王船、蕭壠香、學甲上白礁、麻豆香、土城香（南瀛五大香齊全）、東山迎佛祖、新化十八嬈、府城做十六歲、安平跨年與迎春、鹿耳門聖母廟迎春。節慶：月津港燈節、龍崎空山祭、將軍吼、台灣國際蘭展、關子嶺溫泉美食節。季節景觀：白河木棉花季、白河蓮花季、六甲落羽松季、梅嶺賞梅、梅嶺螢火蟲季、黑面琵鷺季、官田菱角季。
- 效果種類：炮城粒子、高空煙火、王船火焰、蜈蚣陣、遊行隊伍、燈節裝置、山坡燈柱、海灘舞台、整區換樹色（treecolor，color 由資料指定）、蓮花池、螢火蟲、候鳥盤旋、菱角田、蘭展溫室、溫泉蒸氣攤位。
- 點選任何活動會立即預覽效果（不受日期限制），取消選取後恢復依排程顯示。
- 排程寫在 `tools/events_source.json` 的 `schedule`：`{lunar:[月,日]}` 或 `{solar:[月,日]}`，`window` 為前後天數，`solarEnd` 為國曆區間，可給陣列表示多段（例如去程與回程）；`to` 為遊行終點建築。活動只在排程期間出現，卡片列出今年日期與下一次。
- 手機版預覽：`tools/mobile-preview.html` 用 390×844 的 iframe 檢查版面；`tools/mobile-test.html` 是 Pixel 尺寸（412×915）的單一 iframe，自動化測試用（同源，可從外層用 `contentWindow` 操作）。
- 效果會登記成障礙物，行人會被吸引到活動附近但不會走進效果本體；HUD 的「活動」開關可以關掉效果。
- 活動可點，卡片有時間、簡介與來源；側欄有「活動」一節。

## 點人

每個行人都有隨機姓名、身分與住處。點到身上任何一塊零件都算，卡片會顯示身分說明、住在哪座島、現在在做什麼，地面會畫出他目前的路線。身分說明改 `data/roles.json`。

## 島形與人數

- 外圍裝飾小島由 `world.js` 的 `coastline()` 產生；主島輪廓來自真實邊界。
- 人數改 `data/settings.json` 的 `population`。500 人在 M 系列 Mac 的 Chrome 約 110 fps 以上。

## 地形

- 高程來源是 Open-Meteo Elevation API（`tools/fetch_elevation.py` 抓成 `tools/raw/elevation_grid.json`，0.01° 格點）。API 限流時會把 100 點的區塊補成 0，`tools/build_terrain.py` 會偵測對齊 100 的整段零並用 curl 重抓後改寫原始檔。
- 產生高度場：`python3 -I tools/build_terrain.py` → `data/terrain.json`（世界座標、0.5 單位格距、列優先先 z 再 x、高度是 TOP 之上的單位）。
- 公尺 → 世界高度的曲線：40 m 以下為 0，以上 `1.6 * ((m - 40) / 1200) ** 0.7`，上限 2.4；平原保持平坦、丘陵看得出來。不在任何區輪廓內的點歸 0，輪廓內離邊界 0.8 單位以內線性漸弱，島緣不會出現垂直落差。腳本頂端的常數（`SPACING`、`FEATHER`、`CURVE_*`）可調。市界內最高約 1000 m（1700 m 的山脊在市界外），所以目前最高點約 1.0 單位。
- `terrain.js` 的 `createTerrain(THREE, scene, data, TOP)` 回傳 `{ heightAt(x, z), mesh }`：`heightAt` 雙線性取樣（格子外回 0）；`mesh` 是一片 PlaneGeometry 依高度位移、頂點色從陸地色經綠色到灰褐，三個角都是 0 的三角形不畫（水道上方不會多一層蓋住水面），約 4k 個三角形。
- 接上畫面的步驟（尚未接）：`app.js` 多載入 `data/terrain.json`，在 `buildWorld` 之後呼叫 `createTerrain`，再把建築、樹、行人、火車、活動與標籤的 y 從 `TOP` 改成 `TOP + terrain.heightAt(x, z)`。

## 互動功能（2026-10 新增）

- **圖釘**：點地面任意處會放一支圖釘，卡片顯示所在區、最近的建築／景點／車站與距離，並附 Google Maps 連結；Esc 移除。
- **區統計**：點區時顯示人口、面積、此刻行人數、建築、景點、車站、活動數。
- **跟隨**：行人卡片有「跟著他走」；側欄搜尋「跟車」或直接看「🚆 跟車」區塊可跟著兩列火車跑。拖曳畫面即解除。
- **播放一年**：日期列的 ▶ 每秒兩天跑完一年，季節景觀與活動依序出現，年底自動停。
- **活動月曆**：工具列「📅 月曆」打開月曆，每天的色點代表當日活動；點日期跳到那天，點活動直接飛過去並預覽效果。
- **搜尋 Enter**：輸入後按 Enter 直接飛到第一筆地標（建築、景點、車站、活動優先，沒有才選區）。
- **雙擊**：在建築、景點、車站或地面上雙擊直接拉到近景。
- **地圖連結**：建築、景點、車站卡片都有「在 Google Maps 開啟」；非真實座標的建築會標註「位置為區內示意」。
- **日照隨日期**：日出日落依台南緯度與日期計算（夏至約 5:16／18:40，冬至約 6:40／17:16），天色與太陽角度跟著變。
- **聲音**：圖層列的「聲音」開啟環境音（風、鳥、蟲、通勤車流）與活動音效（煙火、鑼鼓、海灘舞台、風鈴、火焰）與火車離站鳴笛；全部由 Web Audio 即時合成，無外部音檔，預設靜音。

模組：`audio.js`、`calendar-panel.js`／`calendar-panel.css`，`environment.js` 的 `setDate`／`getDaylight`，`world.js` 的 `districtAt`／`toLonLat`／`areaKm2`，`people.js` 的 `countIn`，`events.js` 的 `activeKinds`，`train.js` 的 `onDepart`。

## 真實資料與更多玩法（2026-10 第二批）

| 功能 | 做法 | 檔案與重跑指令 |
|---|---|---|
| 即時天氣 | 每 10 分鐘抓 Open-Meteo（免金鑰）；雲量壓暗陽光、下雨飄雨絲、約六成行人撐傘；左上角徽章顯示溫度與天況。`?weather=rain|cloudy|clear` 可用假資料測試。 | `weather.js`、`weather.css`、`environment.js` 的 `setWeather`、`people.js` 的 `setRain` |
| 水庫水位 | Worker 的 `/api/reservoir` 抓水利署開放資料（「水庫水情資料」每小時的有效蓄水量與水位 ＋「水庫每日營運狀況」的有效容量、滿水位、呆水位，以水庫代碼 30502 曾文、30501 烏山頭、30503 南化、30401 白河、30504 鏡面對起來），邊緣快取 1 小時；失敗時用 `data/reservoir_fallback.json`（`node tools/fetch_reservoir.mjs` 更新，卡片標「備援資料」）。尖山埤不在水利署資料裡。水面依蓄水率縮放，上方小牌顯示百分比（80% 以上藍、50–80 黃、以下紅），卡片有水位計，側欄有「水庫蓄水」清單。`?reservoir=30` 可測試；改資料格式時把 worker.js 快取鍵的 `cache=v3` 往上加。 | `worker.js`、`reservoir.js`、`wrangler.toml` 的 `main` |
| 六色公車 | 藍、綠、紅、橘、黃、棕的幹線與全部支線（127 條、往返程與繞駛延駛共 381 個行駛型態、4,000 多個真實站牌）。幹線一直顯示，支線在側欄依顏色打開才載入；往返程各靠右畫兩條虛線，選取路線時另外畫繞駛／延駛；拉近才顯示站牌。時鐘在「現在」（側欄「📡 看現在」）時公車用 TDX 即時 GPS，否則依路線長度配車模擬。 | `python3 -I tools/fetch_bus.py` → `python3 -I tools/build_bus.py` →（有缺口時）`python3 -I tools/fetch_bus_gaps.py` → 再跑一次 `build_bus.py` → `data/bus.json`、`data/bus_branches.json`；`bus.js`、`worker.js` 的 `/api/bus`；測試 `tools/test_bus.py`、`node tools/test_worker_bus.mjs` |
| 糖鐵五分車 | 烏樹林糖廠觀光線（OSM narrow_gauge），窄軌加一列小火車，09:00–16:30 行駛。 | `python3 -I tools/build_sugar.py` → `data/sugar.json`；`sugar.js` |
| 綠道與自行車道 | 山海圳國家綠道（台南段）與六條自行車道畫成虛線，20 位騎士 06:00–19:00 來回。 | `python3 -I tools/fetch_trails.py` → `python3 -I tools/build_trails.py` → `data/trails.json`；`trails.js` |
| 人口年齡結構 | 內政部戶政司 2026-09 單一年齡人口統計，各區 65 歲以上與 14 歲以下比例決定行人裡長者與小孩的數量；區卡片多兩格。 | `tools/population.json` 的 `_ages`、`data/ages.json`、`people.js` |
| 農田依季節變色 | 28 個郊區共 169 塊田，`data/crops.json` 寫各區作物與產季，顏色依日曆日期變化；點田地看作物與階段。 | `tools/build_city.py` 的農田區段、`fields.js`、`python3 -I tools/test_fields.py` |
| 主題導覽 | 「導覽」鈕改成選單：全市巡迴、廟宇巡禮、古蹟一日、夜市之夜、山海一日。網址 `?tour=<id>` 直接開始。 | `data/tours.json` |
| 人流熱度圖 | 圖層列「熱度」：每 2 單位一格，每 0.5 秒統計行人數，顏色越深人越多。`?heat=1` 直接開啟。 | `heatmap.js`、`people.js` 的 `forEachVisible` |
| 英文／日文介面 | 工具列「中／EN／日」切換，記在網址 `?lang=` 與 localStorage；翻譯直接覆蓋進資料物件，Google 地圖查詢仍用原文。翻譯為機器翻譯、未經母語審校。 | `i18n.js`、`data/i18n/`（`ui.*.json`、`data.*.json`）、`python3 -I tools/test_i18n.py` |

各模組的單元測試：`python3 -I tools/test_bus.py`、`test_sugar.py`、`test_trails.py`、`test_fields.py`、`test_i18n.py`。

## 地點擴充與比例（2026-10 第三批）

- 建築從 136 棟增為 221 棟（新增 85 處：古蹟、廟宇、戲院、燈塔、鹽田、棒球場、眷村等），來源仍是 `tools/buildings_source.json`，座標由 `tools/fetch_geocode.py` 查 Nominatim（新增地點 48 處查到真實位置，其餘為區內示意並在卡片標註）。
- 新模型 12 種在 `models-extra.js`：lighthouse、crystalchurch、stilthouse、ballpark、saltfan、suspbridge、lookout、granary、veterans、sunkenplaza、waterfire、shrine。
- 第 24 個活動「頭社太祖夜祭」（農曆十月十四、十五夜），效果 `nightritual` 在 `events.js`。
- 比例：地圖南北 80 單位（原 44 → 66 → 80，`tools/build_city.py` 的 `NS_UNITS`）；市區四區（面積 < `SMALL_AREA` = 24 單位²）建築縮 0.65；行人整體縮 0.75（`people.js` 的 `BASE_SCALE`）；行人、火車、公車、騎士、五分車速度與地形高度、霧距同步放大。改倍率時這些常數要一起動。

## 互動玩法（2026-10 第四批）

| 功能 | 用法 | 檔案 |
|---|---|---|
| 集章 | 工具列「📘 集章」打開章簿；37 區各一個代表地標（`data/stamps.json`），打開它的卡片就蓋章；集滿放煙火。進度存在瀏覽器。 | `stamps.js`、`stamps.css` |
| 第一人稱搭車 | 側欄「跟車」的「上車」、公車與五分車卡片的「上車」；鏡頭在車頭往前看，上方顯示下一站；← → 換車，拖曳或 Esc 下車。 | `app.js` 的 `startRide`／`updateRide` |
| 市民對話 | 點行人時卡片上方冒三句泡泡，依年齡、行程、時間、天氣、所在區活動、住區特產與夜市拼成，連點會換句。 | `talk.js`、`talk.css`、`data/talk.json` |
| 朗讀 | 圖層列「朗讀」：用瀏覽器內建語音唸卡片與導覽字幕，中英日自動選語音。 | `speech.js` |
| 一日行程 | 卡片「加入行程」→ 右下角面板拖曳排序、看總距離、播放（每站 6 秒）、複製分享連結（`?trip=`）。 | `trip.js`、`trip.css` |
| 我的圖釘 | 點地面放圖釘後「存成我的圖釘」並寫一行筆記；側欄最上方列出，可複製分享連結（`?pins=`）。 | `mypins.js` |

## 高鐵

`python3 -I tools/build_hsr.py` 把 `data/rail.json` 的高鐵線段串成一條南北連續路線寫到 `data/hsr.json`（重跑 build_city 後要再跑一次）。`train.js` 的 `opts.style = "hsr"` 是高鐵車型：兩列 8 節對開、只停高鐵台南站、跑在高架橋面（`deckY`），開出地圖範圍就隱藏、到端點折返。側欄「跟車」可跟高鐵或上車。

## 效能、校對與活動提示

- **畫質分級**：`high`／`med`／`low`（解析度倍率、陰影、行人數 500／380／260）。手機、4 核以下或小螢幕從 `med` 起跳；平均 FPS 連續 4 秒低於 28 會自動降一級。`?quality=low` 可強制，`?fps=1` 在左上角顯示 FPS、draw calls、三角形數、可見名牌數。
- **建築名牌**：每 0.25 秒只顯示鏡頭焦點附近最近的 40 個（low 為 20 個），拉遠或搭車時全部隱藏。
- **資料校對**：開本機 `http://127.0.0.1:8787/tools/review.html`，可填沒查到的座標、改待確認的介紹與農特產，匯出 `review.json` 後執行 `python3 -I tools/apply_review.py review.json`（寫回資料、重跑產生器與測試，並列出需要補翻譯的項目）。待確認清單在 `tools/review_flags.json`。
- **今日活動**：品牌下方的小條列出今天在期間內的活動，點了飛過去；全景時進行中的活動標籤保留顯示。

## 農特產互動

| 功能 | 用法 | 檔案 |
|---|---|---|
| 點特產看產地 | 區卡片、側欄、市民卡片裡的特產標籤都能點：產區冒出光柱與圖示約 7 秒，卡片列出產季與全部產區（`?sel=spec:芒果`）。 | `specs.js` |
| 當季 | 圖層列「當季」（預設關）：各區上空顯示這個月當季的特產；標籤上的黃點也表示當季。月份跟著日期（`?d=`）變。 | `specs.js`、`data/spec_seasons.json`、`python3 -I tools/test_specs.py` |
| 猜產地 | 工具列「🎯 猜產地」：一輪 10 題，在地圖上點區作答（點地面、區名、建築都算），答完亮出正確產地；全對放煙火，最佳成績存在瀏覽器。 | `quiz.js`、`stamps.css` |
| 特產一日遊 | 特產卡片「排成一日遊」：產區由北到南加進一日行程。 | `app.js` 的 `data-spec-trip` |
| 市民提菜籃 | 有特產的區，約四分之一的成人與長者左手提一籃住區特產（顏色見產季檔），卡片寫「提著」，對話會聊籃子裡的東西。 | `people.js`、`talk.js`、`data/talk.json` 的 `basket` |

產季有 13 項標 `unsure`，列在校對頁第 4 區，改好後同樣用 `apply_review.py` 寫回。

## 活動擴充（2026-10）

新增 9 個活動（`tools/events_source.json`，重跑 `build_city.py` 產生 `data/events.json`；英日文在 `data/i18n/data.{en,ja}.json`）：孔廟祭孔大典（9/28，新特效 `ceremony` 八佾舞方陣）、大天后宮媽祖聖誕（農曆三月廿三，遊行到安平開臺天后宮）、臺南國際龍舟錦標賽（端午，新特效 `dragonboats`：中西區南緣一條水道與三艘龍舟，路徑在 `path`）、台南國際芒果節（玉井）、麻豆文旦節、臺南鳳梨好筍季（關廟）、東山咖啡節（新特效 `market`：攤位堆特產，`fruit` 顏色、`steam` 是否冒熱氣）、台南好米季（`paddy` 加 `crop: "rice"` 為彩繪稻田）、鳳凰花季（`treecolor` 紅色，東區）。標 `unsure` 的（文旦、鳳梨）日期依往年慣例，待確認。

## 可玩性第二批（2026-10）

工具列的「🎮 玩」選單收納所有小遊戲（集章、猜產地、美食圖鑑、找找阿明、拍照模式），手機工具列才放得下。

| 功能 | 用法 | 檔案 |
|---|---|---|
| 拍照模式 | 收起介面與標籤，選濾鏡（原色／底片／黃昏／黑白／清新）與相框（無／拍立得／明信片），合成浮水印「地點 · 日期 時間」下載 PNG。HTML 標籤不在畫布裡，不會入鏡；Safari 舊版不支援 canvas filter 時照片為原色。 | `photo.js` |
| 找找阿明 | 戴紅毛帽、條紋衣、圓眼鏡的阿明每天（依本機日期）躲在固定一區；三個線索 0／30／60 秒揭露（特產 → 附近地標 → 區號），點到就過關，記錄秒數與連續天數。「暫停」時他也停住。 | `findming.js` |
| 吃遍台南 | `data/food.json` 29 區 35 樣代表小吃（子代理逐筆查證附出處），綁建築或景點；打開該地點卡片就吃到，卡片列「這裡可以吃到」。依據薄弱的列在校對頁第 5 區。 | `food.js`、`python3 -I tools/test_food.py` |
| 劍獅小嚮導 | 左下角（手機右下、預設收合）的劍獅，選取區／建築／景點／活動／特產／水庫時依資料說一句（特產、地標、活動倒數、夜市有沒有開、可以吃什麼），入夜、下雨、閒置 45 秒也會提示。開「朗讀」會一起唸。 | `guide.js` |

## 水庫與湖面（2026-10）

- **曾文水庫示意湖**：曾文水庫的蓄水區大多在嘉義縣大埔鄉，OSM 湖面整片落在區界外。`tools/build_city.py` 把它等比例縮小搬進楠西區（`SCHEMATIC`、`fit_lake`）：湖的壩端對齊壩址、整片湖在區內且避開區中心廣場、車站、鐵路與動線，`water_mrt.json` 的這筆湖標 `schematic: true`，卡片註明是示意。
- **壩址**：`tools/dams.json` 記各水庫主壩的經緯度與出處。壩體建築（`model: "dam"`，曾文、南化、白河、鏡面）放在壩址投到湖岸的位置旁（離岸 0.4）。白河、鏡面兩座壩是新加的建築（`buildings_source.json` 第 4 欄是重點清單，英日文在 `data.{en,ja}.json`）；白河的壩址座標待查證。
- **不放進湖裡**：建築、景點離湖岸至少 0.5，樹 0.25，田不壓到湖。這是放完之後的後處理，不改亂數順序，其他區的配置不變；會印出搬動或拿掉了什麼。`test_build.py` 的 `test_nothing_in_lakes` 檢查車站、景點、活動、建築、樹、田都不在湖裡，`test_reservoir_dams` 檢查示意湖與壩。執行時行人與阿明也不走進湖裡（`world.js` 的 `inLake`）。
- **建築與水庫資訊合併**：`reservoir.js` 的 `ANCHORS` 把每座水庫綁一棟建築或景點（烏山頭 → 景點、尖山埤 → 江南渡假村、其餘 → 壩）。點湖面、蓄水率小牌、側欄的水庫都打開那棟建築的卡片，卡片裡有「💧 即時蓄水」段落（資料更新時整段重畫）；同名的建築不再另外顯示名牌，由蓄水率小牌代替。

## 大學與科技大學（2026-10）

- 依教育部「大專校院名錄」115 學年度，台南招生中的 11 所大學、科技大學、學院都在地圖上（成大、南大、南藝大、長榮、南臺、崑山、南應大、嘉藥、中信科大、華醫、中信金融管理學院），另加台南神學院。停辦的台灣首府大學、南榮科大與停招的康寧大學臺南校區不收。
- 位置：`tools/pinned_buildings.json` 記真實座標（OSM），`build_city.py` 在其他建築放好之後才把它們放到最近的空地（`new: true` 的不參與隨機取樣，其他區配置不變）。市區小區先試著把間距從 0.55 放寬到 0.4（模型會依鄰距自動縮小），都放不下才讓附近隨機落點的建築讓位。`test_build.py` 的 `test_universities` 檢查每所都在、離真實座標 1 單位內。
- 模型：成大 `ncku`（校門、榕園大榕樹、成功湖、日治紅磚系館）、南大 `nutn`（紅樓、操場），其他用共用的 `campus`。

## 公車資料處理（2026-10）

- **路線**：OSM 上 ref 以六色開頭的 route relation（`fetch_bus.py`）。高雄的紅 6x／7x 線依 `network` 與落在台南的比例（< 50%）排除；出了台南的路段只留陸地上最長的一段（往高鐵嘉義站、布袋等）。
- **串路段**：OSM 的成員順序常亂（整段倒序、前後段對調、圓環、中途接入），`chain_ways` 先用共用節點串成幾段，再試每個起點、取缺口總長最短的拼法。OSM 真的少收的路段（缺口附近還有站牌）用 OSRM 公開路徑規劃沿道路補上；路段順序亂到台南境內的站牌收不到 90% 的，改用 OSRM 依序經過每個站牌重畫。OSRM 結果快取在 `tools/raw/bus_gap_routes.json`，重跑不用連網。
- **站牌**：依 OSM 成員順序投到路線上，只往前找（進村再原路折返的路段不會對錯邊）；同名 60 公尺內的 stop／platform 合併。台南境內的站牌收進 97% 以上，沒收到的多在嘉義、高雄。
- **即時位置**：`worker.js` 的 `/api/bus` 用 TDX 的 `RealTimeByFrequency/City/Tainan`（A1），只留六色路線、營運中、5 分鐘內的 GPS；token 在邊緣快取 23 小時。前端每 30 秒問一次，貼到同名路線同方向最近的型態上，30 秒內平滑移過去；離路線超過 2 單位（約 2 公里）的不畫。金鑰用 `npx wrangler secret put TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` 設定，沒設時自動用模擬。**TDX 免費方案每月約 4,500 次呼叫**，`BUS_TTL`（預設 60 秒）只在有人開著網頁時才會打，常態使用建議升級方案或把 `BUS_TTL` 調大。

## 部署（Cloudflare Workers 靜態資產 + Worker）

```bash
npx wrangler@4 login          # 第一次需要授權
sh tools/build_dist.sh        # 複製要上線的檔案到 dist/（不含 tools/）
npx wrangler@4 deploy         # 上傳；設定在 wrangler.toml（main = worker.js 負責 /api/reservoir，其餘交給靜態資產）
```

- 正式網址：https://hexcity.ericlin.io （自訂網域綁在 Worker `hex-city-tainan`）
- 備用網址：https://hex-city-tainan.chihsiang0915.workers.dev
- 改完內容重新 `build_dist` 再 `deploy` 即可，約十秒。
# Hex-City-Tainan
# Hex-City-Tainan
# Hex-City-Tainan
# Hex-City-Tainan
# Hex-City-Tainan
