
const isLocalServer = 
  window.location.hostname === "localhost" || 
  window.location.hostname === "127.0.0.1" || 
  window.location.hostname.startsWith("192.168.") || 
  window.location.hostname.startsWith("10.") || 
  window.location.hostname.startsWith("172.") || 
  window.location.hostname.endsWith(".local") ||
  window.location.port === "8080";

const userProxyUrl = localStorage.getItem("custom-proxy-url") || "";

const customProxyUrl = userProxyUrl 
  ? userProxyUrl 
  : (isLocalServer ? "" : "https://moetruyen.rinmyau.workers.dev");

const API_BASE = customProxyUrl 
  ? customProxyUrl.replace(/\/$/, "") + "/api/v2"
  : (isLocalServer ? "/api/v2" : "https://moe.suicaodex.com/v2");

console.log("MoeTruyen Downloader Init - isLocalServer:", isLocalServer, "API_BASE:", API_BASE);

function getProxiedUrl(originalUrl) {
  if (customProxyUrl) {
    if (originalUrl && originalUrl.startsWith("https://")) {
      const withoutHttps = originalUrl.substring(8);
      return customProxyUrl.replace(/\/$/, "") + "/proxy/" + withoutHttps;
    }
    return originalUrl;
  }

  if (!isLocalServer) return originalUrl;

  if (originalUrl && originalUrl.startsWith("https://")) {
    const withoutHttps = originalUrl.substring(8);
    return "/proxy/" + withoutHttps;
  }
  return originalUrl;
}

function formatChapterNumber(numText) {
  if (numText === null || numText === undefined) return "";
  const numStr = String(numText).trim();
  if (/^\d+(\.\d+)?$/.test(numStr)) {
    return parseFloat(numStr).toString();
  }
  return numStr;
}


const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const mangaGrid = document.getElementById("manga-grid");
const mainLoader = document.getElementById("main-loader");
const welcomeBanner = document.getElementById("welcome-banner");
const resultsHeader = document.getElementById("results-header");
const resultsCountText = document.getElementById("results-count-text");
const clearResultsBtn = document.getElementById("clear-results-btn");

const drawer = document.getElementById("manga-drawer");
const drawerOverlay = document.getElementById("drawer-overlay");
const drawerCloseBtn = document.getElementById("drawer-close-btn");
const drawerContent = document.getElementById("drawer-content");

const showQueueBtn = document.getElementById("show-queue-btn");
const queuePanel = document.getElementById("queue-panel");
const queueCloseBtn = document.getElementById("queue-close-btn");
const queueItemsContainer = document.getElementById("queue-items-container");
const queueBadge = document.getElementById("queue-badge");
const logBodyContainer = document.getElementById("log-body-container");
const clearLogsBtn = document.getElementById("clear-logs-btn");
const concurrencySelect = document.getElementById("concurrency-select");
const formatSelect = document.getElementById("format-select");


const confirmModalOverlay = document.getElementById("confirm-modal-overlay");
const confirmDownloadModal = document.getElementById("confirm-download-modal");
const confirmModalCloseBtn = document.getElementById("confirm-modal-close-btn");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmMangaTitle = document.getElementById("confirm-manga-title");
const confirmChaptersCount = document.getElementById("confirm-chapters-count");
const confirmChaptersList = document.getElementById("confirm-chapters-list");
const modalConcurrencySelect = document.getElementById("modal-concurrency-select");
const modalFormatSelect = document.getElementById("modal-format-select");

// Reader UI Elements
const readerView = document.getElementById("manga-reader-view");
const readerBackBtn = document.getElementById("reader-back-btn");
const readerMangaTitle = document.getElementById("reader-manga-title");
const readerChapterTitle = document.getElementById("reader-chapter-title");
const readerPrevChapterBtn = document.getElementById("reader-prev-chapter-btn");
const readerNextChapterBtn = document.getElementById("reader-next-chapter-btn");
const readerChapterSelect = document.getElementById("reader-chapter-select");
const readerModeScrollBtn = document.getElementById("reader-mode-scroll-btn");
const readerModePageBtn = document.getElementById("reader-mode-page-btn");
const readerContentArea = document.getElementById("reader-content-area");
const readerLoader = document.getElementById("reader-loader");
const readerLoaderText = document.getElementById("reader-loader-text");
const readerPagesScroll = document.getElementById("reader-pages-scroll");
const readerPagesFlip = document.getElementById("reader-pages-flip");
const flipPrevBtn = document.getElementById("flip-prev-btn");
const flipNextBtn = document.getElementById("flip-next-btn");
const flipImage = document.getElementById("flip-image");
const flipPageIndicator = document.getElementById("flip-page-indicator");
const readerThemeSelect = document.getElementById("reader-theme-select");
const recentSection = document.getElementById("recent-reading-section");
const recentGrid = document.getElementById("recent-reading-grid");
const clearHistoryBtn = document.getElementById("clear-history-btn");

let searchResults = [];
let selectedManga = null;
let activeDownloads = [];
let queueIdCounter = 0;

// Reader State
let currentReadingManga = null;
let currentReadingChapter = null;
let activeChapterObserver = null;
let activePageObserver = null;
let infiniteScrollSentinelObserver = null;
let isInfiniteLoadingNext = false;
let chapterGrantsCache = {};
let currentReadingChapterList = [];
let currentReadingPageUrls = [];
let currentReadingDecryptedPages = {}; // pageIndex -> ObjectURL
let currentReadingPageIndex = 0;
let currentReadingMode = "scroll"; // scroll or page
let isImgxDecryptionRequiredGlobal = false;
let currentReadingPageGrantsGlobal = {};


function log(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const logLine = document.createElement("div");
  logLine.className = `log-line ${type}`;
  logLine.innerHTML = `<span style="color: var(--text-muted)">[${timestamp}]</span> ${message}`;
  logBodyContainer.appendChild(logLine);
  logBodyContainer.scrollTop = logBodyContainer.scrollHeight;
}

function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

class CrawlerQueue {
  constructor() {
    this.queue = [];
    this.activeCount = 0;
  }

  get concurrency() {
    return parseInt(concurrencySelect.value, 10) || 2;
  }

  add(manga, chapter) {

    this.queue = this.queue.filter(item => !(item.chapter.id === chapter.id && (item.status === "completed" || item.status === "failed")));


    if (this.queue.some(item => item.chapter.id === chapter.id)) {
      log(`Chapter ${chapter.numberText} đang được tải hoặc đã có trong hàng chờ.`, "warning");
      return;
    }

    const queueItem = {
      id: ++queueIdCounter,
      manga: manga,
      chapter: chapter,
      status: "pending",
      progress: 0,
      pagesDownloaded: 0,
      totalPages: chapter.pages || 0,
      error: null
    };

    this.queue.push(queueItem);
    log(`Đã thêm vào hàng chờ: ${manga.title} - Chapter ${chapter.numberText}`, "system");

    this.render();
    this.process();


    queuePanel.classList.add("active");
  }

  process() {
    if (this.activeCount >= this.concurrency) return;

    const nextItem = this.queue.find(item => item.status === "pending");
    if (!nextItem) return;

    nextItem.status = "downloading";
    this.activeCount++;
    this.render();

    log(`Bắt đầu tải: ${nextItem.manga.title} - Chapter ${nextItem.chapter.numberText}`, "info");

    this.downloadChapter(nextItem)
      .then(() => {
        nextItem.status = "completed";
        nextItem.progress = 100;
        this.activeCount--;
        log(`Tải thành công & Lưu file ZIP: ${nextItem.manga.title} - Chapter ${nextItem.chapter.numberText}`, "success");
        this.render();
        this.process();
      })
      .catch((err) => {
        nextItem.status = "failed";
        nextItem.error = err.message || err;
        this.activeCount--;
        log(`Lỗi khi tải Chapter ${nextItem.chapter.numberText}: ${nextItem.error}`, "error");
        this.render();
        this.process();
      });
  }

  async downloadChapter(item) {

    const res = await fetch(`${API_BASE}/chapters/${item.chapter.id}`);
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error("Chapter bị khóa (yêu cầu mật khẩu hoặc quyền truy cập đặc biệt).");
      }
      throw new Error(`Lỗi HTTP ${res.status} khi lấy danh sách trang.`);
    }

    const payload = await res.json();
    if (!payload.success || !payload.data || !payload.data.pageUrls) {
      throw new Error("Không lấy được danh sách URL trang từ API.");
    }

    const pageUrls = payload.data.pageUrls;
    item.totalPages = pageUrls.length;
    this.render();

    if (pageUrls.length === 0) {
      throw new Error("Chapter này không có trang ảnh nào.");
    }


    const firstUrl = pageUrls[0] || "";
    const cleanFirstUrl = firstUrl.split(/[?#]/)[0].toLowerCase();
    const isImgx = cleanFirstUrl.endsWith(".bin") || cleanFirstUrl.endsWith(".js");

    let pageGrants = {};
    let isImgxDecryptionRequired = false;

    if (isImgx) {
      log("Chương truyện sử dụng định dạng IMGX bảo mật. Đang lấy khóa giải mã...", "info");
      try {

        const firstGrantRes = await fetch(`${API_BASE}/chapters/${item.chapter.id}/page-access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageIndexes: [0] })
        });

        if (firstGrantRes.ok) {
          const firstGrantPayload = await firstGrantRes.json();
          if (firstGrantPayload.success && firstGrantPayload.data) {
            isImgxDecryptionRequired = true;
            const maxWindow = firstGrantPayload.data.maxWindow || 5;


            if (firstGrantPayload.data.pages && firstGrantPayload.data.pages[0]) {
              pageGrants[0] = firstGrantPayload.data.pages[0];
            }


            const remainingIndexes = [];
            for (let i = 1; i < pageUrls.length; i++) {
              remainingIndexes.push(i);
            }

            log(`Đã xác thực IMGX. Đang lấy khóa giải mã cho ${remainingIndexes.length} trang còn lại (kích thước nhóm: ${maxWindow})...`, "info");

            for (let i = 0; i < remainingIndexes.length; i += maxWindow) {
              const batch = remainingIndexes.slice(i, i + maxWindow);
              const batchRes = await fetch(`${API_BASE}/chapters/${item.chapter.id}/page-access`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageIndexes: batch })
              });

              if (!batchRes.ok) {
                throw new Error(`Lỗi HTTP ${batchRes.status} khi lấy khóa giải mã trang.`);
              }

              const batchPayload = await batchRes.json();
              if (batchPayload.success && batchPayload.data && batchPayload.data.pages) {
                batchPayload.data.pages.forEach(pg => {
                  pageGrants[pg.pageIndex] = pg;
                });
              }
            }
            log("Đã tải xong toàn bộ khóa giải mã IMGX.", "success");
          }
        } else if (firstGrantRes.status === 404) {
          log("Chương không sử dụng mã hóa IMGX (hoặc đã mở khóa công khai). Bỏ qua giải mã.", "warning");
        } else {
          throw new Error(`Lỗi HTTP ${firstGrantRes.status} khi bắt đầu xác thực IMGX.`);
        }
      } catch (err) {
        log(`Cảnh báo xác thực IMGX thất bại: ${err.message}. Thử tải trực tiếp...`, "warning");
      }
    }

    const zip = new JSZip();
    const folder = zip.folder(`Chapter_${item.chapter.numberText}`);


    for (let i = 0; i < pageUrls.length; i++) {

      const url = isImgxDecryptionRequired && pageGrants[i]
        ? getProxiedUrl(pageGrants[i].downloadUrl)
        : getProxiedUrl(pageUrls[i]);

      let success = false;
      let attempt = 0;
      let blob = null;

      while (!success && attempt < 3) {
        try {
          attempt++;
          const pageRes = await fetch(url);
          if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);

          if (isImgxDecryptionRequired && pageGrants[i]) {

            const arrayBuffer = await pageRes.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuffer);


            if (uint8[0] === 0x49 && uint8[1] === 0x4d && uint8[2] === 0x47 && uint8[3] === 0x58) {
              const decoded = await decodeImgxToWebp(arrayBuffer, pageGrants[i].grant, pageGrants[i].storageKey);
              blob = new Blob([decoded.webp], { type: "image/webp" });
            } else {

              const scriptText = new TextDecoder().decode(uint8);
              const match = scriptText.match(/window\.pages\.push\(\s*["'`](data:[^"'`]+)["'`]\s*\)/);
              if (!match) {
                throw new Error("Dữ liệu tải về không chứa chữ ký IMGX và không phải JS Base64.");
              }
              blob = dataURLtoBlob(match[1]);
            }
          } else {

            const arrayBuffer = await pageRes.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuffer);

            const textContent = new TextDecoder().decode(uint8);
            const match = textContent.match(/window\.pages\.push\(\s*["'`](data:[^"'`]+)["'`]\s*\)/);

            if (match) {
              blob = dataURLtoBlob(match[1]);
            } else {

              blob = new Blob([arrayBuffer], { type: pageRes.headers.get("Content-Type") || "image/webp" });
            }
          }
          success = true;
        } catch (err) {
          log(`Lỗi tải trang ${i + 1}/${pageUrls.length} (Lần thử ${attempt}/3): ${err.message}`, "warning");
          if (attempt >= 3) throw err;

          await new Promise(r => setTimeout(r, 1000));
        }
      }


      const saveFormat = formatSelect ? formatSelect.value : "png";
      let finalBlob = blob;
      let extension = ".webp";

      if (saveFormat === "png") {
        try {
          finalBlob = await convertToPngBlob(blob);
          extension = ".png";
        } catch (err) {
          log(`Lỗi convert PNG trang ${i + 1}/${pageUrls.length}: ${err.message}. Giữ định dạng gốc.`, "warning");
          extension = blob.type === "image/png" ? ".png" : (blob.type === "image/jpeg" ? ".jpg" : ".webp");
        }
      } else {
        extension = blob.type === "image/png" ? ".png" : (blob.type === "image/jpeg" ? ".jpg" : ".webp");
      }


      const filename = String(i + 1).padStart(3, "0") + extension;
      folder.file(filename, finalBlob);

      item.pagesDownloaded = i + 1;
      item.progress = Math.round(((i + 1) / pageUrls.length) * 100);
      this.render();
    }


    item.status = "zipping";
    this.render();
    log(`Đang nén file ZIP: ${item.manga.title} - Chapter ${item.chapter.numberText}...`, "info");

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const cleanMangaTitle = item.manga.title.replace(/[\\/:*?"<>|]/g, "");
    saveAs(zipBlob, `${cleanMangaTitle} - Ch ${item.chapter.numberText}.zip`);
  }

  render() {
    if (this.queue.length === 0) {
      queueItemsContainer.innerHTML = `
        <div class="empty-queue-msg">
          <i class="fa-solid fa-box-open"></i>
          <p>Không có lượt tải nào đang chạy</p>
        </div>
      `;
      queueBadge.style.display = "none";
      return;
    }


    const activeJobs = this.queue.filter(item => item.status === "pending" || item.status === "downloading" || item.status === "zipping").length;
    if (activeJobs > 0) {
      queueBadge.innerText = activeJobs;
      queueBadge.style.display = "flex";
    } else {
      queueBadge.style.display = "none";
    }

    queueItemsContainer.innerHTML = this.queue.map(item => {
      let statusText = "Chờ tải";
      if (item.status === "downloading") statusText = `Đang tải (${item.pagesDownloaded}/${item.totalPages})`;
      if (item.status === "zipping") statusText = "Đang nén ZIP";
      if (item.status === "completed") statusText = "Đã xong";
      if (item.status === "failed") statusText = "Thất bại";

      return `
        <div class="queue-item ${item.status}" id="queue-item-${item.id}">
          <div class="queue-item-header">
            <div>
              <div class="queue-item-title">Ch. ${item.chapter.numberText} ${item.chapter.title ? `- ${item.chapter.title}` : ''}</div>
              <div class="queue-item-manga">${item.manga.title}</div>
            </div>
            <span class="queue-item-status">${statusText}</span>
          </div>
          <div class="queue-progress-bar">
            <div class="queue-progress-fill" style="width: ${item.progress}%"></div>
          </div>
          <div class="queue-progress-text">
            <span>Tiến độ</span>
            <span>${item.progress}%</span>
          </div>
          ${item.error ? `<div style="font-size: 0.75rem; color: var(--danger); margin-top: 4px;"><i class="fa-solid fa-circle-exclamation"></i> Lỗi: ${item.error}</div>` : ""}
        </div>
      `;
    }).join("");
  }
}





const IMGX_HEADER_BYTES = 13;
const IMGX_KEY_BYTES = 32;
const IMGX_MAGIC = [0x49, 0x4d, 0x47, 0x58];
const IMGX_LEGACY_VERSION = 2;
const IMGX_VERSION = 3;
const IMGX_V3_NONCE_BYTES = 12;
const IMGX_V3_AUTH_TAG_BYTES = 16;

const textEncoder = new TextEncoder();

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function bytesToArrayBuffer(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Base64Url(bytes) {
  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    bytesToArrayBuffer(bytes),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function normalizeStorageKey(storageKey) {
  return storageKey.trim().replace(/^\/+/, "");
}

function nextXorShift32(value) {
  let x = value >>> 0;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
}

function fnv1a32(bytes) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    hash ^= bytes[index] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x9e3779b9;
}

function seedFromKey(key) {
  if (key.byteLength < 4) {
    throw new Error("IMGX key invalid");
  }
  const seed = new DataView(
    key.buffer,
    key.byteOffset,
    key.byteLength,
  ).getUint32(0, false);
  return seed || 0x9e3779b9;
}

function createGrantKeyWrapMaterial(grant, storageKey) {
  return [
    "IMGX-GRANT-WRAP-v1",
    grant.version,
    grant.algorithm,
    grant.imageId,
    grant.issuedAt,
    grant.expiresAt,
    grant.nonce,
    grant.keyNonce,
    grant.signature,
    normalizeStorageKey(storageKey),
  ].join(".");
}

function createGrantKeyMask(material, byteLength = IMGX_KEY_BYTES) {
  const mask = new Uint8Array(byteLength);
  let seed = fnv1a32(textEncoder.encode(material));

  for (let index = 0; index < byteLength; index += 1) {
    if (index % 4 === 0) {
      seed = nextXorShift32((seed + index + 0x9e3779b9) >>> 0);
    }
    mask[index] = (seed >>> ((index % 4) * 8)) & 0xff;
  }

  return mask;
}

function swapByte(bytes, left, right) {
  if (left === right) return;
  const tmp = bytes[left];
  bytes[left] = bytes[right];
  bytes[right] = tmp;
}

function unshuffleBytesInPlace(bytes, key) {
  const swaps = new Uint32Array(bytes.byteLength);
  let seed = seedFromKey(key);

  for (let index = bytes.byteLength - 1; index > 0; index -= 1) {
    seed = nextXorShift32(seed);
    swaps[index] = seed % (index + 1);
  }

  for (let index = 1; index < bytes.byteLength; index += 1) {
    swapByte(bytes, index, swaps[index] ?? 0);
  }
}

function xorBytesInPlace(bytes, key) {
  if (key.byteLength === 0) {
    throw new Error("IMGX key missing");
  }

  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] = (bytes[index] ?? 0) ^ (key[index % key.byteLength] ?? 0);
  }
}

function parseImgxHeader(binary) {
  if (binary.byteLength <= IMGX_HEADER_BYTES) {
    throw new Error("IMGX payload empty");
  }

  for (let index = 0; index < IMGX_MAGIC.length; index += 1) {
    if (binary[index] !== IMGX_MAGIC[index]) {
      throw new Error("IMGX magic invalid");
    }
  }

  const version = Number(binary[4]) || 0;

  if (version !== IMGX_LEGACY_VERSION && version !== IMGX_VERSION) {
    throw new Error("IMGX version invalid");
  }

  const view = new DataView(
    binary.buffer,
    binary.byteOffset,
    binary.byteLength,
  );
  const width = view.getUint32(5, false);
  const height = view.getUint32(9, false);

  if (width <= 0 || height <= 0) {
    throw new Error("IMGX dimensions invalid");
  }

  return { version, width, height };
}

async function unwrapImgxGrantWrappedKey(
  grant,
  storageKey,
  fieldName,
  hashFieldName,
  label,
) {
  const wrapped = base64UrlToBytes(grant[fieldName]);

  if (wrapped.byteLength !== IMGX_KEY_BYTES) {
    throw new Error(`${label} invalid`);
  }

  const mask = createGrantKeyMask(
    createGrantKeyWrapMaterial(grant, storageKey),
    wrapped.byteLength,
  );
  xorBytesInPlace(wrapped, mask);

  if ((await sha256Base64Url(wrapped)) !== grant[hashFieldName]) {
    throw new Error(`${label} hash mismatch`);
  }

  return wrapped;
}

function createImgxV3AdditionalData(
  grant,
  storageKey,
  header,
) {
  const imageId = grant.imageId.trim();

  if (!imageId) {
    throw new Error("IMGX v3 image id missing");
  }

  return textEncoder.encode(
    [
      "IMGX-v3",
      imageId,
      normalizeStorageKey(storageKey),
      Math.max(1, Math.floor(Number(header.width) || 0)),
      Math.max(1, Math.floor(Number(header.height) || 0)),
    ].join("."),
  );
}

async function decodeImgxV3ToWebp(
  binary,
  grant,
  storageKey,
  header,
) {
  if (!window.crypto?.subtle) {
    throw new Error("IMGX v3 requires WebCrypto");
  }

  if (
    binary.byteLength <=
    IMGX_HEADER_BYTES + IMGX_V3_NONCE_BYTES + IMGX_V3_AUTH_TAG_BYTES
  ) {
    throw new Error("IMGX v3 payload empty");
  }

  const contentKey = await unwrapImgxGrantWrappedKey(
    grant,
    storageKey,
    "wrappedContentKey",
    "contentKeyHash",
    "IMGX wrapped content key"
  );
  const nonce = binary.slice(
    IMGX_HEADER_BYTES,
    IMGX_HEADER_BYTES + IMGX_V3_NONCE_BYTES,
  );
  const encryptedWithTag = binary.slice(
    IMGX_HEADER_BYTES + IMGX_V3_NONCE_BYTES,
  );
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(contentKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytesToArrayBuffer(nonce),
      additionalData: bytesToArrayBuffer(
        createImgxV3AdditionalData(grant, storageKey, header),
      ),
      tagLength: 128,
    },
    cryptoKey,
    bytesToArrayBuffer(encryptedWithTag),
  );

  return new Uint8Array(decrypted);
}

async function decodeImgxToWebp(
  source,
  grant,
  storageKey,
) {
  const binary = source instanceof Uint8Array ? source : new Uint8Array(source);
  const header = parseImgxHeader(binary);

  if (header.version === IMGX_VERSION) {
    const webp = await decodeImgxV3ToWebp(binary, grant, storageKey, header);
    return {
      width: header.width,
      height: header.height,
      webp,
    };
  }

  const decodeKey = await unwrapImgxGrantWrappedKey(
    grant,
    storageKey,
    "wrappedDecodeKey",
    "keyHash",
    "IMGX wrapped decode key"
  );
  const webp = binary.slice(IMGX_HEADER_BYTES);

  unshuffleBytesInPlace(webp, decodeKey);
  xorBytesInPlace(webp, decodeKey);

  return {
    width: header.width,
    height: header.height,
    webp,
  };
}

const downloadQueue = new CrawlerQueue();


async function searchManga(query) {
  if (!query.trim()) return;

  mangaGrid.innerHTML = "";
  mainLoader.style.display = "flex";
  welcomeBanner.style.display = "none";
  resultsHeader.style.display = "none";

  try {
    const res = await fetch(`${API_BASE}/search/manga?q=${encodeURIComponent(query)}&include=genres`);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

    const payload = await res.json();
    if (!payload.success || !payload.data) {
      throw new Error("Không có dữ liệu phản hồi từ máy chủ.");
    }

    searchResults = payload.data;
    renderMangaGrid(searchResults);
  } catch (err) {
    log(`Lỗi tìm kiếm: ${err.message}`, "error");
    mangaGrid.innerHTML = `
      <div class="empty-queue-msg" style="grid-column: 1/-1; color: var(--danger)">
        <i class="fa-solid fa-circle-exclamation"></i>
        <p>Lỗi kết nối API: ${err.message}</p>
      </div>
    `;
  } finally {
    mainLoader.style.display = "none";
  }
}


function renderMangaGrid(mangaList) {
  resultsHeader.style.display = "flex";
  resultsCountText.innerText = `Tìm thấy ${mangaList.length} truyện`;

  if (mangaList.length === 0) {
    mangaGrid.innerHTML = `
      <div class="empty-queue-msg" style="grid-column: 1/-1">
        <i class="fa-solid fa-circle-question"></i>
        <p>Không tìm thấy truyện nào khớp với từ khóa tìm kiếm</p>
      </div>
    `;
    return;
  }

  mangaGrid.innerHTML = mangaList.map(manga => {
    const statusClass = manga.status === "ongoing" ? "ongoing" : "completed";
    const statusText = manga.status === "ongoing" ? "Đang tiến hành" : "Hoàn thành";

    let coverSrc = manga.coverUrl || "https://placehold.co/200x280/161e31/ffffff?text=No+Cover";

    return `
      <div class="manga-card" data-id="${manga.id}">
        <div class="card-cover-wrapper">
          <img src="${coverSrc}" class="card-cover" alt="${manga.title}" loading="lazy">
          <span class="card-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="card-details">
          <h3 class="card-title" title="${manga.title}">${manga.title}</h3>
          <div class="card-info">
            <span class="card-author" title="${manga.author || 'Chưa cập nhật'}">
              <i class="fa-solid fa-user"></i> ${manga.author || 'Ẩn danh'}
            </span>
            <span class="card-chapters-count">${manga.chapterCount || 0} chương</span>
          </div>
        </div>
      </div>
    `;
  }).join("");


  document.querySelectorAll(".manga-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = parseInt(card.dataset.id, 10);
      const manga = searchResults.find(m => m.id === id);
      if (manga) {
        showMangaDetails(manga);
      }
    });
  });
}


async function fetchAllChapters(mangaId) {
  let allChapters = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetch(`${API_BASE}/manga/${mangaId}/chapters?limit=100&page=${page}`);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

    const payload = await res.json();
    if (!payload.success || !payload.data) {
      throw new Error("Không thể tải danh sách chương.");
    }

    const data = payload.data;
    const chapters = data.chapters || [];
    allChapters = allChapters.concat(chapters);

    if (payload.meta && payload.meta.pagination) {
      totalPages = payload.meta.pagination.totalPages || 1;
    }
    page++;
  } while (page <= totalPages);

  return allChapters;
}


async function showMangaDetails(manga) {
  selectedManga = manga;


  drawerOverlay.classList.add("active");
  drawer.classList.add("active");

  drawerContent.innerHTML = `
    <div class="loader-container">
      <div class="spinner"></div>
      <p>Đang tải danh sách chương truyện...</p>
    </div>
  `;

  try {
    const chapters = await fetchAllChapters(manga.id);


    chapters.forEach(ch => {
      ch.numberText = formatChapterNumber(ch.numberText);
    });


    chapters.sort((a, b) => a.number - b.number);

    let coverSrc = manga.coverUrl || "https://placehold.co/200x280/161e31/ffffff?text=No+Cover";

    drawerContent.innerHTML = `
      <div class="drawer-meta-section">
        <img src="${coverSrc}" class="drawer-cover" alt="${manga.title}">
        <div class="drawer-details-info">
          <h2 class="drawer-title">${manga.title}</h2>
          <div class="drawer-author-meta"><i class="fa-solid fa-user-pen"></i> Tác giả: <strong>${manga.author || 'Chưa rõ'}</strong></div>
          <div class="drawer-author-meta"><i class="fa-solid fa-folder"></i> Nhóm dịch: <strong>${manga.groupName || 'Không có'}</strong></div>
          <div class="drawer-status-meta">
            <span class="tag"><i class="fa-solid fa-list-ol"></i> ${chapters.length} chương</span>
            <span class="tag"><i class="fa-solid fa-clock"></i> Cập nhật: ${new Date(manga.updatedAt).toLocaleDateString("vi-VN")}</span>
          </div>
        </div>
      </div>

      <div class="manga-desc">
        <strong>Tóm tắt nội dung:</strong><br>
        ${manga.description || 'Không có tóm tắt nội dung cho tác phẩm này.'}
      </div>

      <div class="chapters-action-bar">
        <h4>Danh sách chương (${chapters.length})</h4>
        <div class="select-actions">
          <input type="text" id="chapter-filter-input" placeholder="Lọc chương..." class="chapter-filter-input">
          <button id="select-all-chapters" class="btn btn-secondary btn-small">Chọn hết</button>
          <button id="deselect-all-chapters" class="btn btn-secondary btn-small">Bỏ chọn</button>
        </div>
      </div>

      <div class="chapter-list-wrapper">
        ${chapters.length === 0 ? '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Không tìm thấy chương truyện công khai nào.</p>' :
          chapters.map(ch => {
            const isPublic = ch.access === "public";
            const accessBadgeClass = isPublic ? "public" : "locked";
            const accessBadgeText = isPublic ? "Public" : "Bị khóa";

            return `
              <div class="chapter-row" data-chapter-id="${ch.id}">
                <div class="chapter-row-left">
                  <input type="checkbox" class="chapter-checkbox" data-id="${ch.id}" ${isPublic ? '' : 'disabled'}>
                  <span class="chapter-num">Chương ${ch.numberText}</span>
                  <span class="chapter-title" title="${ch.title || ''}">${ch.title ? `- ${ch.title}` : ''}</span>
                </div>
                <div class="chapter-row-right">
                  <span class="chapter-pages">${ch.pages ? `${ch.pages} trang` : 'Không rõ trang'}</span>
                  <div class="chapter-row-actions">
                    <span class="chapter-badge ${accessBadgeClass}">${accessBadgeText}</span>
                    ${isPublic ? `<button class="btn-read-chapter" data-id="${ch.id}"><i class="fa-solid fa-book-open"></i> Đọc</button>` : ''}
                  </div>
                </div>
              </div>
            `;
          }).join("")
        }
      </div>

      <div class="drawer-actions">
        <button id="download-selected-btn" class="btn btn-primary" ${chapters.length === 0 ? 'disabled' : ''}>
          <i class="fa-solid fa-download"></i> Tải các chương đã chọn
        </button>
      </div>
    `;


    document.querySelectorAll(".chapter-row").forEach(row => {
      row.addEventListener("click", (e) => {

        if (e.target.classList.contains("chapter-checkbox") || e.target.closest(".btn-read-chapter")) return;

        const cb = row.querySelector(".chapter-checkbox");
        if (cb && !cb.disabled) {
          cb.checked = !cb.checked;
        }
      });
    });

    document.querySelectorAll(".btn-read-chapter").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const chId = parseInt(btn.dataset.id, 10);
        const chapter = chapters.find(c => c.id === chId);
        if (chapter) {
          openReader(selectedManga, chapter, chapters);
        }
      });
    });

    const filterInput = document.getElementById("chapter-filter-input");
    filterInput.addEventListener("input", () => {
      const query = filterInput.value.trim().toLowerCase();
      document.querySelectorAll(".chapter-row").forEach(row => {
        const numText = row.querySelector(".chapter-num").innerText.toLowerCase();
        const titleText = row.querySelector(".chapter-title").innerText.toLowerCase();
        if (numText.includes(query) || titleText.includes(query)) {
          row.style.display = "flex";
        } else {
          row.style.display = "none";
        }
      });
    });


    document.getElementById("select-all-chapters").addEventListener("click", () => {
      document.querySelectorAll(".chapter-checkbox:not(:disabled)").forEach(cb => cb.checked = true);
    });
    document.getElementById("deselect-all-chapters").addEventListener("click", () => {
      document.querySelectorAll(".chapter-checkbox").forEach(cb => cb.checked = false);
    });


    document.getElementById("download-selected-btn").addEventListener("click", () => {
      const checkedBoxes = document.querySelectorAll(".chapter-checkbox:checked");
      if (checkedBoxes.length === 0) {
        alert("Vui lòng chọn ít nhất một chương truyện công khai để tải!");
        return;
      }

      const selectedChapters = [];
      checkedBoxes.forEach(cb => {
        const id = parseInt(cb.dataset.id, 10);
        const chapter = chapters.find(c => c.id === id);
        if (chapter) {
          selectedChapters.push(chapter);
        }
      });

      showConfirmDownloadModal(selectedManga, selectedChapters);
    });

  } catch (err) {
    log(`Lỗi lấy danh sách chương: ${err.message}`, "error");
    drawerContent.innerHTML = `
      <div class="empty-queue-msg" style="color: var(--danger)">
        <i class="fa-solid fa-circle-exclamation"></i>
        <p>Lỗi tải danh sách chương: ${err.message}</p>
      </div>
    `;
  }
}

function closeDrawer() {
  drawer.classList.remove("active");
  drawerOverlay.classList.remove("active");
  selectedManga = null;
}


searchBtn.addEventListener("click", () => searchManga(searchInput.value));
searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchManga(searchInput.value);
});

clearResultsBtn.addEventListener("click", () => {
  searchInput.value = "";
  mangaGrid.innerHTML = "";
  welcomeBanner.style.display = "block";
  resultsHeader.style.display = "none";
});

drawerCloseBtn.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);

showQueueBtn.addEventListener("click", () => {
  queuePanel.classList.toggle("active");
});
queueCloseBtn.addEventListener("click", () => {
  queuePanel.classList.remove("active");
});

clearLogsBtn.addEventListener("click", () => {
  logBodyContainer.innerHTML = `<div class="log-line system">Console cleared.</div>`;
});

concurrencySelect.addEventListener("change", () => {
  log(`Thay đổi cài đặt tải song song: ${concurrencySelect.value} chapter(s).`, "system");
  downloadQueue.process();
});

function convertToPngBlob(imageBlob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageBlob);

    const timeoutId = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("Timeout khi chuyển đổi sang PNG."));
    }, 15000);

    img.onload = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            resolve(pngBlob);
          } else {
            reject(new Error("canvas.toBlob trả về null."));
          }
        }, "image/png");
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      reject(new Error("Không thể load hình ảnh vào canvas. Định dạng ảnh có thể không hợp lệ."));
    };

    img.src = url;
  });
}

function showConfirmDownloadModal(manga, selectedChapters) {
  confirmMangaTitle.innerText = manga.title;
  confirmChaptersCount.innerText = `Đã chọn ${selectedChapters.length} chương truyện`;

  confirmChaptersList.innerHTML = selectedChapters.map(ch => `
    <div class="confirm-chapter-item">
      <i class="fa-solid fa-file-image"></i>
      <span>Chương ${ch.numberText} ${ch.title ? `- ${ch.title}` : ''}</span>
    </div>
  `).join("");


  modalConcurrencySelect.value = concurrencySelect.value;
  modalFormatSelect.value = formatSelect.value;


  confirmModalOverlay.classList.add("active");
  confirmDownloadModal.classList.add("active");


  const onStartDownload = () => {

    concurrencySelect.value = modalConcurrencySelect.value;
    formatSelect.value = modalFormatSelect.value;


    log(`Bắt đầu tiến trình tải. Cài đặt: ${concurrencySelect.value} chapter(s) song song, Định dạng: ${formatSelect.value.toUpperCase()}`, "system");


    selectedChapters.forEach(chapter => {
      downloadQueue.add(manga, chapter);
    });

    closeConfirmModal();
    closeDrawer();
  };


  const startBtn = document.getElementById("confirm-start-btn");
  const newStartBtn = startBtn.cloneNode(true);
  startBtn.parentNode.replaceChild(newStartBtn, startBtn);
  newStartBtn.addEventListener("click", onStartDownload);
}

function closeConfirmModal() {
  confirmModalOverlay.classList.remove("active");
  confirmDownloadModal.classList.remove("active");
}


confirmModalCloseBtn.addEventListener("click", closeConfirmModal);
confirmCancelBtn.addEventListener("click", closeConfirmModal);
confirmModalOverlay.addEventListener("click", closeConfirmModal);

// Reader Functions

function openReader(manga, chapter, chapters) {
  document.body.style.overflow = "hidden";
  currentReadingManga = manga;
  currentReadingChapter = chapter;
  currentReadingChapterList = chapters.filter(ch => ch.access === "public");

  readerChapterSelect.innerHTML = currentReadingChapterList.map(ch => `
    <option value="${ch.id}">${ch.numberText ? `Chương ${ch.numberText}` : 'Không rõ số'} ${ch.title ? `- ${ch.title}` : ''}</option>
  `).join("");
  readerChapterSelect.value = chapter.id;

  const theme = localStorage.getItem("reader-theme") || "theme-dark";
  readerThemeSelect.value = theme;
  readerView.className = `reader-view active ${theme}`;
  loadReaderChapter(chapter);
}

function closeReader() {
  document.body.style.overflow = "";
  const theme = localStorage.getItem("reader-theme") || "theme-dark";
  readerView.className = `reader-view ${theme}`;
  cleanupReaderMemory();
  currentReadingManga = null;
  currentReadingChapter = null;
  currentReadingChapterList = [];
  currentReadingPageUrls = [];
  if (activeChapterObserver) activeChapterObserver.disconnect();
  if (activePageObserver) activePageObserver.disconnect();
  if (infiniteScrollSentinelObserver) infiniteScrollSentinelObserver.disconnect();
}

function cleanupReaderMemory() {
  Object.values(currentReadingDecryptedPages).forEach(url => {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("Failed to revoke object URL", e);
    }
  });
  currentReadingDecryptedPages = {};
  chapterGrantsCache = {};
}

async function loadReaderChapter(chapter) {
  cleanupReaderMemory();
  chapterGrantsCache = {};
  
  readerMangaTitle.innerText = currentReadingManga.title;
  readerChapterTitle.innerText = `Chương ${chapter.numberText}${chapter.title ? ` - ${chapter.title}` : ""}`;

  const currentIndex = currentReadingChapterList.findIndex(ch => ch.id === chapter.id);
  readerPrevChapterBtn.disabled = currentIndex <= 0;
  readerNextChapterBtn.disabled = currentIndex >= currentReadingChapterList.length - 1;

  readerLoaderText.innerText = "Đang tải danh sách trang truyện...";
  readerLoader.style.display = "flex";
  
  readerPagesScroll.innerHTML = "";
  readerPagesScroll.style.display = "none";
  readerPagesFlip.style.display = "none";

  if (activeChapterObserver) activeChapterObserver.disconnect();
  if (activePageObserver) activePageObserver.disconnect();
  if (infiniteScrollSentinelObserver) infiniteScrollSentinelObserver.disconnect();

  try {
    const res = await fetch(`${API_BASE}/chapters/${chapter.id}`);
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error("Chương truyện bị khóa.");
      }
      throw new Error(`HTTP Error ${res.status}`);
    }

    const payload = await res.json();
    if (!payload.success || !payload.data || !payload.data.pageUrls) {
      throw new Error("Không lấy được danh sách trang từ API.");
    }

    const pageUrls = payload.data.pageUrls;
    currentReadingPageUrls = pageUrls;

    if (pageUrls.length === 0) {
      throw new Error("Chương này không có trang ảnh nào.");
    }

    const firstUrl = pageUrls[0] || "";
    const cleanFirstUrl = firstUrl.split(/[?#]/)[0].toLowerCase();
    const isImgx = cleanFirstUrl.endsWith(".bin") || cleanFirstUrl.endsWith(".js");

    let pageGrants = {};
    let isImgxDecryptionRequired = false;

    if (isImgx) {
      readerLoaderText.innerText = "Chương bảo mật. Đang tải khóa giải mã...";
      const firstGrantRes = await fetch(`${API_BASE}/chapters/${chapter.id}/page-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageIndexes: [0] })
      });

      if (firstGrantRes.ok) {
        const firstGrantPayload = await firstGrantRes.json();
        if (firstGrantPayload.success && firstGrantPayload.data) {
          isImgxDecryptionRequired = true;
          const maxWindow = firstGrantPayload.data.maxWindow || 5;

          if (firstGrantPayload.data.pages && firstGrantPayload.data.pages[0]) {
            pageGrants[0] = firstGrantPayload.data.pages[0];
          }

          const remainingIndexes = [];
          for (let i = 1; i < pageUrls.length; i++) {
            remainingIndexes.push(i);
          }

          for (let i = 0; i < remainingIndexes.length; i += maxWindow) {
            const batch = remainingIndexes.slice(i, i + maxWindow);
            const batchRes = await fetch(`${API_BASE}/chapters/${chapter.id}/page-access`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pageIndexes: batch })
            });

            if (batchRes.ok) {
              const batchPayload = await batchRes.json();
              if (batchPayload.success && batchPayload.data && batchPayload.data.pages) {
                batchPayload.data.pages.forEach(pg => {
                  pageGrants[pg.pageIndex] = pg;
                });
              }
            }
          }
        }
      }
    }

    isImgxDecryptionRequiredGlobal = isImgxDecryptionRequired;
    currentReadingPageGrantsGlobal = pageGrants;
    chapterGrantsCache[chapter.id] = pageGrants;

    readerLoader.style.display = "none";

    saveReadingProgress(currentReadingManga, chapter);

    if (currentReadingMode === "scroll") {
      loadAllPagesScrollMode();
    } else {
      currentReadingPageIndex = 0;
      showFlipPage(0);
    }
  } catch (err) {
    readerLoaderText.innerText = `Lỗi: ${err.message}`;
    const errorMsg = document.createElement("p");
    errorMsg.style.cssText = "color: var(--danger); margin-top: 10px; font-weight: bold;";
    errorMsg.innerText = "Không thể mở chương truyện này.";
    readerLoader.appendChild(errorMsg);
  }
}

async function fetchAndDecryptPage(idx, pageUrl, isImgx, pageGrants, chapterId) {
  const cacheKey = `${chapterId}_${idx}`;
  if (currentReadingDecryptedPages[cacheKey]) {
    return currentReadingDecryptedPages[cacheKey];
  }

  const url = isImgx && pageGrants[idx]
    ? getProxiedUrl(pageGrants[idx].downloadUrl)
    : getProxiedUrl(pageUrl);

  const pageRes = await fetch(url);
  if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);

  let blob = null;
  if (isImgx && pageGrants[idx]) {
    const arrayBuffer = await pageRes.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    if (uint8[0] === 0x49 && uint8[1] === 0x4d && uint8[2] === 0x47 && uint8[3] === 0x58) {
      const decoded = await decodeImgxToWebp(arrayBuffer, pageGrants[idx].grant, pageGrants[idx].storageKey);
      blob = new Blob([decoded.webp], { type: "image/webp" });
    } else {
      const scriptText = new TextDecoder().decode(uint8);
      const match = scriptText.match(/window\.pages\.push\(\s*["'`](data:[^"'`]+)["'`]\s*\)/);
      if (!match) {
        throw new Error("Dữ liệu tải về không chứa chữ ký IMGX và không phải JS Base64.");
      }
      blob = dataURLtoBlob(match[1]);
    }
  } else {
    const arrayBuffer = await pageRes.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const textContent = new TextDecoder().decode(uint8);
    const match = textContent.match(/window\.pages\.push\(\s*["'`](data:[^"'`]+)["'`]\s*\)/);

    if (match) {
      blob = dataURLtoBlob(match[1]);
    } else {
      blob = new Blob([arrayBuffer], { type: pageRes.headers.get("Content-Type") || "image/webp" });
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  currentReadingDecryptedPages[cacheKey] = objectUrl;
  return objectUrl;
}

function initObservers() {
  if (activeChapterObserver) activeChapterObserver.disconnect();
  if (activePageObserver) activePageObserver.disconnect();

  activeChapterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const sec = entry.target;
        const chId = parseInt(sec.dataset.chapterId, 10);
        const chNumber = sec.dataset.chapterNumber;
        const chTitle = sec.dataset.chapterTitle;

        readerChapterSelect.value = chId;
        readerChapterTitle.innerText = `Chương ${chNumber}${chTitle ? ` - ${chTitle}` : ""}`;

        const currentIndex = currentReadingChapterList.findIndex(ch => ch.id === chId);
        readerPrevChapterBtn.disabled = currentIndex <= 0;
        readerNextChapterBtn.disabled = currentIndex >= currentReadingChapterList.length - 1;

        const activeChapter = currentReadingChapterList[currentIndex];
        if (activeChapter && currentReadingChapter.id !== chId) {
          currentReadingChapter = activeChapter;
          saveReadingProgress(currentReadingManga, activeChapter);
        }
      }
    });
  }, {
    root: readerContentArea,
    rootMargin: "-20% 0px -60% 0px"
  });

  activePageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const wrapper = entry.target;
        const idx = parseInt(wrapper.dataset.index, 10);
        const pUrl = wrapper.dataset.pageUrl;
        const chId = parseInt(wrapper.dataset.chapterId, 10);
        const chImgx = wrapper.dataset.isImgx === "true";
        
        activePageObserver.unobserve(wrapper);

        const grants = chapterGrantsCache[chId] || {};

        fetchAndDecryptPage(idx, pUrl, chImgx, grants, chId)
          .then(objectUrl => {
            wrapper.innerHTML = "";
            const img = document.createElement("img");
            img.className = "reader-page-img";
            img.src = objectUrl;
            img.alt = `Trang ${idx + 1}`;
            img.onload = () => img.classList.add("loaded");
            wrapper.appendChild(img);

            const indicator = document.createElement("span");
            indicator.style.cssText = "position: absolute; bottom: 10px; right: 10px; font-size: 0.75rem; color: var(--text-muted); background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px;";
            indicator.innerText = `${idx + 1} / ${wrapper.dataset.totalPages}`;
            wrapper.appendChild(indicator);

            const totalPages = parseInt(wrapper.dataset.totalPages, 10);
            if (idx + 1 < totalPages) {
              const nextWrapper = wrapper.nextElementSibling;
              if (nextWrapper && nextWrapper.classList.contains("reader-page-wrapper")) {
                preDecryptPage(idx + 1, nextWrapper.dataset.pageUrl, chImgx, grants, chId);
              }
            }
          })
          .catch(err => {
            console.error(err);
            wrapper.innerHTML = `
              <div style="color: var(--danger); text-align: center; padding: 1rem;">
                <i class="fa-solid fa-triangle-exclamation"></i> Lỗi tải trang: ${err.message}
              </div>
            `;
          });
      }
    });
  }, {
    root: readerContentArea,
    rootMargin: "1000px 0px 1000px 0px"
  });
}

function loadAllPagesScrollMode() {
  readerPagesScroll.style.display = "flex";
  readerPagesFlip.style.display = "none";
  readerPagesScroll.innerHTML = "";

  const totalPages = currentReadingPageUrls.length;
  if (totalPages === 0) return;

  const section = document.createElement("div");
  section.className = "reader-chapter-section";
  section.dataset.chapterId = currentReadingChapter.id;
  section.dataset.chapterNumber = currentReadingChapter.numberText;
  section.dataset.chapterTitle = currentReadingChapter.title || "";
  readerPagesScroll.appendChild(section);

  initObservers();

  for (let i = 0; i < totalPages; i++) {
    const wrapper = document.createElement("div");
    wrapper.className = "reader-page-wrapper";
    wrapper.dataset.index = i;
    wrapper.dataset.pageUrl = currentReadingPageUrls[i];
    wrapper.dataset.chapterId = currentReadingChapter.id;
    wrapper.dataset.isImgx = isImgxDecryptionRequiredGlobal ? "true" : "false";
    wrapper.dataset.totalPages = totalPages;
    wrapper.innerHTML = `
      <div class="spinner"></div>
      <span style="position: absolute; bottom: 10px; right: 10px; font-size: 0.75rem; color: var(--text-muted); background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px;">${i + 1} / ${totalPages}</span>
    `;
    section.appendChild(wrapper);
    activePageObserver.observe(wrapper);
  }

  activeChapterObserver.observe(section);
  setupInfiniteScrollSentinel();
}

function setupInfiniteScrollSentinel() {
  const oldSentinel = document.getElementById("infinite-scroll-sentinel");
  if (oldSentinel) oldSentinel.remove();

  if (infiniteScrollSentinelObserver) {
    infiniteScrollSentinelObserver.disconnect();
  }

  const sentinel = document.createElement("div");
  sentinel.id = "infinite-scroll-sentinel";
  sentinel.style.cssText = "padding: 2rem; text-align: center; color: var(--text-muted); width: 100%; border-top: 1px solid rgba(255, 255, 255, 0.05); font-size: 0.9rem; font-weight: 500;";
  sentinel.innerHTML = `
    <div class="infinite-loading-spinner spinner" style="display: none; margin: 0 auto 0.5rem auto;"></div>
    <span class="infinite-status-text">Kéo tiếp để tải chương tiếp theo</span>
  `;
  readerPagesScroll.appendChild(sentinel);

  infiniteScrollSentinelObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !isInfiniteLoadingNext) {
        triggerLoadNextChapterInfinite();
      }
    });
  }, {
    root: readerContentArea,
    rootMargin: "200px"
  });

  infiniteScrollSentinelObserver.observe(sentinel);
}

async function triggerLoadNextChapterInfinite() {
  const currentIndex = currentReadingChapterList.findIndex(ch => ch.id === currentReadingChapter.id);
  if (currentIndex >= currentReadingChapterList.length - 1) {
    const statusText = document.querySelector("#infinite-scroll-sentinel .infinite-status-text");
    if (statusText) statusText.innerText = "Đã đọc hết chương mới nhất!";
    return;
  }

  const nextChapter = currentReadingChapterList[currentIndex + 1];
  isInfiniteLoadingNext = true;

  const spinner = document.querySelector("#infinite-scroll-sentinel .infinite-loading-spinner");
  const statusText = document.querySelector("#infinite-scroll-sentinel .infinite-status-text");
  if (spinner) spinner.style.display = "block";
  if (statusText) statusText.innerText = `Đang tải Chương ${nextChapter.numberText}...`;

  try {
    const res = await fetch(`${API_BASE}/chapters/${nextChapter.id}`);
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

    const payload = await res.json();
    if (!payload.success || !payload.data || !payload.data.pageUrls) {
      throw new Error("Không tải được danh sách trang.");
    }

    const pageUrls = payload.data.pageUrls;
    if (pageUrls.length === 0) throw new Error("Chương không có trang nào.");

    const firstUrl = pageUrls[0] || "";
    const cleanFirstUrl = firstUrl.split(/[?#]/)[0].toLowerCase();
    const isImgx = cleanFirstUrl.endsWith(".bin") || cleanFirstUrl.endsWith(".js");

    let pageGrants = {};
    if (isImgx) {
      const firstGrantRes = await fetch(`${API_BASE}/chapters/${nextChapter.id}/page-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageIndexes: [0] })
      });

      if (firstGrantRes.ok) {
        const firstGrantPayload = await firstGrantRes.json();
        if (firstGrantPayload.success && firstGrantPayload.data) {
          const maxWindow = firstGrantPayload.data.maxWindow || 5;
          if (firstGrantPayload.data.pages && firstGrantPayload.data.pages[0]) {
            pageGrants[0] = firstGrantPayload.data.pages[0];
          }

          const remainingIndexes = [];
          for (let i = 1; i < pageUrls.length; i++) remainingIndexes.push(i);

          for (let i = 0; i < remainingIndexes.length; i += maxWindow) {
            const batch = remainingIndexes.slice(i, i + maxWindow);
            const batchRes = await fetch(`${API_BASE}/chapters/${nextChapter.id}/page-access`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pageIndexes: batch })
            });

            if (batchRes.ok) {
              const batchPayload = await batchRes.json();
              if (batchPayload.success && batchPayload.data && batchPayload.data.pages) {
                batchPayload.data.pages.forEach(pg => {
                  pageGrants[pg.pageIndex] = pg;
                });
              }
            }
          }
        }
      }
    }

    chapterGrantsCache[nextChapter.id] = pageGrants;

    const sentinel = document.getElementById("infinite-scroll-sentinel");
    const section = document.createElement("div");
    section.className = "reader-chapter-section";
    section.dataset.chapterId = nextChapter.id;
    section.dataset.chapterNumber = nextChapter.numberText;
    section.dataset.chapterTitle = nextChapter.title || "";

    readerPagesScroll.insertBefore(section, sentinel);

    const totalPages = pageUrls.length;
    for (let i = 0; i < totalPages; i++) {
      const wrapper = document.createElement("div");
      wrapper.className = "reader-page-wrapper";
      wrapper.dataset.index = i;
      wrapper.dataset.pageUrl = pageUrls[i];
      wrapper.dataset.chapterId = nextChapter.id;
      wrapper.dataset.isImgx = isImgx ? "true" : "false";
      wrapper.dataset.totalPages = totalPages;
      wrapper.innerHTML = `
        <div class="spinner"></div>
        <span style="position: absolute; bottom: 10px; right: 10px; font-size: 0.75rem; color: var(--text-muted); background: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px;">${i + 1} / ${totalPages}</span>
      `;
      section.appendChild(wrapper);
      activePageObserver.observe(wrapper);
    }

    activeChapterObserver.observe(section);

    if (spinner) spinner.style.display = "none";
    if (statusText) statusText.innerText = "Kéo tiếp để tải chương tiếp theo";
  } catch (err) {
    console.error(err);
    if (spinner) spinner.style.display = "none";
    if (statusText) statusText.innerText = `Lỗi tải chương tiếp theo: ${err.message}. Thử lại...`;
  } finally {
    isInfiniteLoadingNext = false;
  }
}

async function showFlipPage(index) {
  readerPagesScroll.style.display = "none";
  readerPagesFlip.style.display = "flex";

  const totalPages = currentReadingPageUrls.length;
  if (totalPages === 0) {
    flipImage.style.display = "none";
    flipPageIndicator.innerText = "Trang 0 / 0";
    return;
  }

  currentReadingPageIndex = index;
  flipPageIndicator.innerText = `Trang ${index + 1} / ${totalPages}`;
  flipImage.style.display = "none";

  let pageLoader = readerPagesFlip.querySelector(".page-flip-loader");
  if (!pageLoader) {
    pageLoader = document.createElement("div");
    pageLoader.className = "page-flip-loader spinner";
    pageLoader.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);";
    readerPagesFlip.appendChild(pageLoader);
  }
  pageLoader.style.display = "block";

  try {
    const grants = chapterGrantsCache[currentReadingChapter.id] || {};
    const objectUrl = await fetchAndDecryptPage(index, currentReadingPageUrls[index], isImgxDecryptionRequiredGlobal, grants, currentReadingChapter.id);
    flipImage.src = objectUrl;
    flipImage.style.display = "block";
    pageLoader.style.display = "none";

    if (index + 1 < totalPages) {
      preDecryptPage(index + 1, currentReadingPageUrls[index + 1], isImgxDecryptionRequiredGlobal, grants, currentReadingChapter.id);
    }
    if (index + 2 < totalPages) {
      preDecryptPage(index + 2, currentReadingPageUrls[index + 2], isImgxDecryptionRequiredGlobal, grants, currentReadingChapter.id);
    }
    if (index - 1 >= 0) {
      preDecryptPage(index - 1, currentReadingPageUrls[index - 1], isImgxDecryptionRequiredGlobal, grants, currentReadingChapter.id);
    }
  } catch (err) {
    console.error(err);
    pageLoader.style.display = "none";
    flipPageIndicator.innerText = `Lỗi tải trang ${index + 1}`;
  }
}

function preDecryptPage(index, pageUrl, isImgx, pageGrants, chapterId) {
  const cacheKey = `${chapterId}_${index}`;
  if (!currentReadingDecryptedPages[cacheKey]) {
    fetchAndDecryptPage(index, pageUrl, isImgx, pageGrants, chapterId)
      .catch(err => console.warn("Background prefetch failed for page index " + index, err));
  }
}

function goToPrevChapter() {
  const currentIndex = currentReadingChapterList.findIndex(ch => ch.id === currentReadingChapter.id);
  if (currentIndex > 0) {
    const prevChapter = currentReadingChapterList[currentIndex - 1];
    currentReadingChapter = prevChapter;
    readerChapterSelect.value = prevChapter.id;
    loadReaderChapter(prevChapter);
  }
}

function goToNextChapter() {
  const currentIndex = currentReadingChapterList.findIndex(ch => ch.id === currentReadingChapter.id);
  if (currentIndex < currentReadingChapterList.length - 1) {
    const nextChapter = currentReadingChapterList[currentIndex + 1];
    currentReadingChapter = nextChapter;
    readerChapterSelect.value = nextChapter.id;
    loadReaderChapter(nextChapter);
  } else {
    alert("Bạn đã đọc tới chương mới nhất!");
  }
}

// Reader Event Listeners
readerBackBtn.addEventListener("click", closeReader);
readerPrevChapterBtn.addEventListener("click", goToPrevChapter);
readerNextChapterBtn.addEventListener("click", goToNextChapter);

readerChapterSelect.addEventListener("change", () => {
  const chId = parseInt(readerChapterSelect.value, 10);
  const chapter = currentReadingChapterList.find(c => c.id === chId);
  if (chapter) {
    currentReadingChapter = chapter;
    loadReaderChapter(chapter);
  }
});

readerModeScrollBtn.addEventListener("click", () => {
  if (currentReadingMode === "scroll") return;
  currentReadingMode = "scroll";
  readerModeScrollBtn.classList.add("active");
  readerModePageBtn.classList.remove("active");
  loadAllPagesScrollMode();
});

readerModePageBtn.addEventListener("click", () => {
  if (currentReadingMode === "page") return;
  currentReadingMode = "page";
  readerModePageBtn.classList.add("active");
  readerModeScrollBtn.classList.remove("active");
  showFlipPage(0);
});

flipPrevBtn.addEventListener("click", () => {
  if (currentReadingPageIndex > 0) {
    showFlipPage(currentReadingPageIndex - 1);
  } else {
    goToPrevChapter();
  }
});

flipNextBtn.addEventListener("click", () => {
  if (currentReadingPageIndex < currentReadingPageUrls.length - 1) {
    showFlipPage(currentReadingPageIndex + 1);
  } else {
    goToNextChapter();
  }
});

// Touch Swipes on Mobile (Page Flip Mode)
let touchStartX = 0;
let touchEndX = 0;

readerPagesFlip.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

readerPagesFlip.addEventListener("touchend", (e) => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipeGesture();
}, { passive: true });

function handleSwipeGesture() {
  const diff = touchEndX - touchStartX;
  if (Math.abs(diff) < 50) return;

  if (diff > 0) {
    if (currentReadingPageIndex > 0) {
      showFlipPage(currentReadingPageIndex - 1);
    } else {
      goToPrevChapter();
    }
  } else {
    if (currentReadingPageIndex < currentReadingPageUrls.length - 1) {
      showFlipPage(currentReadingPageIndex + 1);
    } else {
      goToNextChapter();
    }
  }
}

// Keyboard controls
window.addEventListener("keydown", (e) => {
  if (!readerView.classList.contains("active")) return;

  if (e.key === "Escape") {
    closeReader();
  } else if (e.key === "ArrowLeft") {
    if (currentReadingMode === "page") {
      if (currentReadingPageIndex > 0) {
        showFlipPage(currentReadingPageIndex - 1);
      } else {
        goToPrevChapter();
      }
    }
  } else if (e.key === "ArrowRight") {
    if (currentReadingMode === "page") {
      if (currentReadingPageIndex < currentReadingPageUrls.length - 1) {
        showFlipPage(currentReadingPageIndex + 1);
      } else {
        goToNextChapter();
      }
    }
  }
});

// Theme Select Event Listener
readerThemeSelect.addEventListener("change", () => {
  const selected = readerThemeSelect.value;
  readerView.className = `reader-view active ${selected}`;
  localStorage.setItem("reader-theme", selected);
});

// Reading History Functions
function saveReadingProgress(manga, chapter) {
  if (!manga || !chapter) return;

  let history = [];
  try {
    history = JSON.parse(localStorage.getItem("manga-reading-history")) || [];
  } catch (e) {
    history = [];
  }

  const item = {
    mangaId: manga.id,
    title: manga.title,
    coverUrl: manga.coverUrl,
    author: manga.author,
    chapterId: chapter.id,
    chapterNumber: chapter.numberText,
    chapterTitle: chapter.title,
    timestamp: Date.now()
  };

  history = history.filter(h => h.mangaId !== manga.id);
  history.unshift(item);

  if (history.length > 5) {
    history = history.slice(0, 5);
  }

  localStorage.setItem("manga-reading-history", JSON.stringify(history));
  renderRecentReading();
}

function renderRecentReading() {
  if (!recentSection || !recentGrid) return;

  let history = [];
  try {
    history = JSON.parse(localStorage.getItem("manga-reading-history")) || [];
  } catch (e) {
    history = [];
  }

  if (history.length === 0) {
    recentSection.style.display = "none";
    return;
  }

  recentSection.style.display = "block";
  recentGrid.innerHTML = history.map(item => {
    const timeString = new Date(item.timestamp).toLocaleDateString("vi-VN") + " " + new Date(item.timestamp).toLocaleTimeString("vi-VN", {hour: '2-digit', minute:'2-digit'});
    const coverSrc = item.coverUrl || "https://placehold.co/200x280/161e31/ffffff?text=No+Cover";
    return `
      <div class="recent-card" data-manga-id="${item.mangaId}" data-chapter-id="${item.chapterId}">
        <button class="recent-remove-btn" data-manga-id="${item.mangaId}" title="Xóa khỏi lịch sử">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <div class="recent-cover-wrapper">
          <img src="${coverSrc}" class="recent-cover" alt="${item.title}" loading="lazy">
        </div>
        <div class="recent-details">
          <h4 class="recent-title" title="${item.title}">${item.title}</h4>
          <div class="recent-chapter">Đang đọc: Ch. ${item.chapterNumber}</div>
          <div class="recent-time"><i class="fa-regular fa-clock"></i> ${timeString}</div>
        </div>
      </div>
    `;
  }).join("");

  recentGrid.querySelectorAll(".recent-card").forEach(card => {
    card.addEventListener("click", async (e) => {
      if (e.target.closest(".recent-remove-btn")) return;

      const mangaId = parseInt(card.dataset.mangaId, 10);
      const chapterId = parseInt(card.dataset.chapterId, 10);

      const historyItem = history.find(h => h.mangaId === mangaId);
      if (!historyItem) return;

      card.style.opacity = "0.7";
      card.style.pointerEvents = "none";
      try {
        const mangaObj = {
          id: mangaId,
          title: historyItem.title,
          coverUrl: historyItem.coverUrl,
          author: historyItem.author
        };
        const chapters = await fetchAllChapters(mangaId);
        chapters.forEach(ch => {
          ch.numberText = formatChapterNumber(ch.numberText);
        });
        chapters.sort((a, b) => a.number - b.number);

        const chapter = chapters.find(ch => ch.id === chapterId);
        if (chapter) {
          selectedManga = mangaObj;
          openReader(mangaObj, chapter, chapters);
        } else {
          alert("Không tìm thấy chương truyện này nữa. Có thể đã bị xóa.");
        }
      } catch (err) {
        alert("Lỗi tải thông tin chương truyện: " + err.message);
      } finally {
        card.style.opacity = "";
        card.style.pointerEvents = "";
      }
    });
  });

  recentGrid.querySelectorAll(".recent-remove-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mangaId = parseInt(btn.dataset.mangaId, 10);
      removeRecentReading(mangaId);
    });
  });
}

function removeRecentReading(mangaId) {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem("manga-reading-history")) || [];
  } catch (e) {
    history = [];
  }
  history = history.filter(h => h.mangaId !== mangaId);
  localStorage.setItem("manga-reading-history", JSON.stringify(history));
  renderRecentReading();
}

clearHistoryBtn.addEventListener("click", () => {
  if (confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử đọc truyện?")) {
    localStorage.removeItem("manga-reading-history");
    renderRecentReading();
  }
});

// Initialize Recent Reading and Theme on load
(function initReaderPreferences() {
  const theme = localStorage.getItem("reader-theme") || "theme-dark";
  if (readerThemeSelect) readerThemeSelect.value = theme;
  if (readerView) readerView.className = `reader-view ${theme}`;
  renderRecentReading();

  // Initialize Custom Proxy input
  const proxyInput = document.getElementById("proxy-input");
  if (proxyInput) {
    proxyInput.value = localStorage.getItem("custom-proxy-url") || "";
    proxyInput.addEventListener("change", () => {
      const value = proxyInput.value.trim();
      if (value) {
        localStorage.setItem("custom-proxy-url", value);
      } else {
        localStorage.removeItem("custom-proxy-url");
      }
      log("Đã cập nhật Proxy/API Base. Đang làm mới trang...", "system");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    });
  }
})();
