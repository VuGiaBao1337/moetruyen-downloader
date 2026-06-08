
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

let searchResults = [];
let selectedManga = null;
let activeDownloads = [];
let queueIdCounter = 0;


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
      log(`Chapter ${chapter.numberText} Ä‘ang Ä‘Æ°á»£c táº£i hoáº·c Ä‘Ã£ cÃ³ trong hÃ ng chá».`, "warning");
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
    log(`ÄÃ£ thÃªm vÃ o hÃ ng chá»: ${manga.title} - Chapter ${chapter.numberText}`, "system");

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

    log(`Báº¯t Ä‘áº§u táº£i: ${nextItem.manga.title} - Chapter ${nextItem.chapter.numberText}`, "info");

    this.downloadChapter(nextItem)
      .then(() => {
        nextItem.status = "completed";
        nextItem.progress = 100;
        this.activeCount--;
        log(`Táº£i thÃ nh cÃ´ng & LÆ°u file ZIP: ${nextItem.manga.title} - Chapter ${nextItem.chapter.numberText}`, "success");
        this.render();
        this.process();
      })
      .catch((err) => {
        nextItem.status = "failed";
        nextItem.error = err.message || err;
        this.activeCount--;
        log(`Lá»—i khi táº£i Chapter ${nextItem.chapter.numberText}: ${nextItem.error}`, "error");
        this.render();
        this.process();
      });
  }

  async downloadChapter(item) {

    const res = await fetch(`${API_BASE}/chapters/${item.chapter.id}`);
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error("Chapter bá»‹ khÃ³a (yÃªu cáº§u máº­t kháº©u hoáº·c quyá»n truy cáº­p Ä‘áº·c biá»‡t).");
      }
      throw new Error(`Lá»—i HTTP ${res.status} khi láº¥y danh sÃ¡ch trang.`);
    }

    const payload = await res.json();
    if (!payload.success || !payload.data || !payload.data.pageUrls) {
      throw new Error("KhÃ´ng láº¥y Ä‘Æ°á»£c danh sÃ¡ch URL trang tá»« API.");
    }

    const pageUrls = payload.data.pageUrls;
    item.totalPages = pageUrls.length;
    this.render();

    if (pageUrls.length === 0) {
      throw new Error("Chapter nÃ y khÃ´ng cÃ³ trang áº£nh nÃ o.");
    }


    const firstUrl = pageUrls[0] || "";
    const cleanFirstUrl = firstUrl.split(/[?#]/)[0].toLowerCase();
    const isImgx = cleanFirstUrl.endsWith(".bin") || cleanFirstUrl.endsWith(".js");

    let pageGrants = {};
    let isImgxDecryptionRequired = false;

    if (isImgx) {
      log("ChÆ°Æ¡ng truyá»‡n sá»­ dá»¥ng Ä‘á»‹nh dáº¡ng IMGX báº£o máº­t. Äang láº¥y khÃ³a giáº£i mÃ£...", "info");
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

            log(`ÄÃ£ xÃ¡c thá»±c IMGX. Äang láº¥y khÃ³a giáº£i mÃ£ cho ${remainingIndexes.length} trang cÃ²n láº¡i (kÃ­ch thÆ°á»›c nhÃ³m: ${maxWindow})...`, "info");

            for (let i = 0; i < remainingIndexes.length; i += maxWindow) {
              const batch = remainingIndexes.slice(i, i + maxWindow);
              const batchRes = await fetch(`${API_BASE}/chapters/${item.chapter.id}/page-access`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageIndexes: batch })
              });

              if (!batchRes.ok) {
                throw new Error(`Lá»—i HTTP ${batchRes.status} khi láº¥y khÃ³a giáº£i mÃ£ trang.`);
              }

              const batchPayload = await batchRes.json();
              if (batchPayload.success && batchPayload.data && batchPayload.data.pages) {
                batchPayload.data.pages.forEach(pg => {
                  pageGrants[pg.pageIndex] = pg;
                });
              }
            }
            log("ÄÃ£ táº£i xong toÃ n bá»™ khÃ³a giáº£i mÃ£ IMGX.", "success");
          }
        } else if (firstGrantRes.status === 404) {
          log("ChÆ°Æ¡ng khÃ´ng sá»­ dá»¥ng mÃ£ hÃ³a IMGX (hoáº·c Ä‘Ã£ má»Ÿ khÃ³a cÃ´ng khai). Bá» qua giáº£i mÃ£.", "warning");
        } else {
          throw new Error(`Lá»—i HTTP ${firstGrantRes.status} khi báº¯t Ä‘áº§u xÃ¡c thá»±c IMGX.`);
        }
      } catch (err) {
        log(`Cáº£nh bÃ¡o xÃ¡c thá»±c IMGX tháº¥t báº¡i: ${err.message}. Thá»­ táº£i trá»±c tiáº¿p...`, "warning");
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
                throw new Error("Dá»¯ liá»‡u táº£i vá» khÃ´ng chá»©a chá»¯ kÃ½ IMGX vÃ  khÃ´ng pháº£i JS Base64.");
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
          log(`Lá»—i táº£i trang ${i + 1}/${pageUrls.length} (Láº§n thá»­ ${attempt}/3): ${err.message}`, "warning");
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
          log(`Lá»—i convert PNG trang ${i + 1}/${pageUrls.length}: ${err.message}. Giá»¯ Ä‘á»‹nh dáº¡ng gá»‘c.`, "warning");
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
    log(`Äang nÃ©n file ZIP: ${item.manga.title} - Chapter ${item.chapter.numberText}...`, "info");

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const cleanMangaTitle = item.manga.title.replace(/[\\/:*?"<>|]/g, "");
    saveAs(zipBlob, `${cleanMangaTitle} - Ch ${item.chapter.numberText}.zip`);
  }

  render() {
    if (this.queue.length === 0) {
      queueItemsContainer.innerHTML = `
        <div class="empty-queue-msg">
          <i class="fa-solid fa-box-open"></i>
          <p>KhÃ´ng cÃ³ lÆ°á»£t táº£i nÃ o Ä‘ang cháº¡y</p>
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
      let statusText = "Chá» táº£i";
      if (item.status === "downloading") statusText = `Äang táº£i (${item.pagesDownloaded}/${item.totalPages})`;
      if (item.status === "zipping") statusText = "Äang nÃ©n ZIP";
      if (item.status === "completed") statusText = "ÄÃ£ xong";
      if (item.status === "failed") statusText = "Tháº¥t báº¡i";

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
            <span>Tiáº¿n Ä‘á»™</span>
            <span>${item.progress}%</span>
          </div>
          ${item.error ? `<div style="font-size: 0.75rem; color: var(--danger); margin-top: 4px;"><i class="fa-solid fa-circle-exclamation"></i> Lá»—i: ${item.error}</div>` : ""}
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
      throw new Error("KhÃ´ng cÃ³ dá»¯ liá»‡u pháº£n há»“i tá»« mÃ¡y chá»§.");
    }

    searchResults = payload.data;
    renderMangaGrid(searchResults);
  } catch (err) {
    log(`Lá»—i tÃ¬m kiáº¿m: ${err.message}`, "error");
    mangaGrid.innerHTML = `
      <div class="empty-queue-msg" style="grid-column: 1/-1; color: var(--danger)">
        <i class="fa-solid fa-circle-exclamation"></i>
        <p>Lá»—i káº¿t ná»‘i API: ${err.message}</p>
      </div>
    `;
  } finally {
    mainLoader.style.display = "none";
  }
}


function renderMangaGrid(mangaList) {
  resultsHeader.style.display = "flex";
  resultsCountText.innerText = `TÃ¬m tháº¥y ${mangaList.length} truyá»‡n`;

  if (mangaList.length === 0) {
    mangaGrid.innerHTML = `
      <div class="empty-queue-msg" style="grid-column: 1/-1">
        <i class="fa-solid fa-circle-question"></i>
        <p>KhÃ´ng tÃ¬m tháº¥y truyá»‡n nÃ o khá»›p vá»›i tá»« khÃ³a tÃ¬m kiáº¿m</p>
      </div>
    `;
    return;
  }

  mangaGrid.innerHTML = mangaList.map(manga => {
    const statusClass = manga.status === "ongoing" ? "ongoing" : "completed";
    const statusText = manga.status === "ongoing" ? "Äang tiáº¿n hÃ nh" : "HoÃ n thÃ nh";

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
            <span class="card-author" title="${manga.author || 'ChÆ°a cáº­p nháº­t'}">
              <i class="fa-solid fa-user"></i> ${manga.author || 'áº¨n danh'}
            </span>
            <span class="card-chapters-count">${manga.chapterCount || 0} chÆ°Æ¡ng</span>
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
      throw new Error("KhÃ´ng thá»ƒ táº£i danh sÃ¡ch chÆ°Æ¡ng.");
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
      <p>Äang táº£i danh sÃ¡ch chÆ°Æ¡ng truyá»‡n...</p>
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
          <div class="drawer-author-meta"><i class="fa-solid fa-user-pen"></i> TÃ¡c giáº£: <strong>${manga.author || 'ChÆ°a rÃµ'}</strong></div>
          <div class="drawer-author-meta"><i class="fa-solid fa-folder"></i> NhÃ³m dá»‹ch: <strong>${manga.groupName || 'KhÃ´ng cÃ³'}</strong></div>
          <div class="drawer-status-meta">
            <span class="tag"><i class="fa-solid fa-list-ol"></i> ${chapters.length} chÆ°Æ¡ng</span>
            <span class="tag"><i class="fa-solid fa-clock"></i> Cáº­p nháº­t: ${new Date(manga.updatedAt).toLocaleDateString("vi-VN")}</span>
          </div>
        </div>
      </div>

      <div class="manga-desc">
        <strong>TÃ³m táº¯t ná»™i dung:</strong><br>
        ${manga.description || 'KhÃ´ng cÃ³ tÃ³m táº¯t ná»™i dung cho tÃ¡c pháº©m nÃ y.'}
      </div>

      <div class="chapters-action-bar">
        <h4>Danh sÃ¡ch chÆ°Æ¡ng (${chapters.length})</h4>
        <div class="select-actions">
          <input type="text" id="chapter-filter-input" placeholder="Lá»c chÆ°Æ¡ng..." class="chapter-filter-input">
          <button id="select-all-chapters" class="btn btn-secondary btn-small">Chá»n háº¿t</button>
          <button id="deselect-all-chapters" class="btn btn-secondary btn-small">Bá» chá»n</button>
        </div>
      </div>

      <div class="chapter-list-wrapper">
        ${chapters.length === 0 ? '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">KhÃ´ng tÃ¬m tháº¥y chÆ°Æ¡ng truyá»‡n cÃ´ng khai nÃ o.</p>' :
          chapters.map(ch => {
            const isPublic = ch.access === "public";
            const accessBadgeClass = isPublic ? "public" : "locked";
            const accessBadgeText = isPublic ? "Public" : "Bá»‹ khÃ³a";

            return `
              <div class="chapter-row" data-chapter-id="${ch.id}">
                <div class="chapter-row-left">
                  <input type="checkbox" class="chapter-checkbox" data-id="${ch.id}" ${isPublic ? '' : 'disabled'}>
                  <span class="chapter-num">ChÆ°Æ¡ng ${ch.numberText}</span>
                  <span class="chapter-title" title="${ch.title || ''}">${ch.title ? `- ${ch.title}` : ''}</span>
                </div>
                <div class="chapter-row-right">
                  <span class="chapter-pages">${ch.pages ? `${ch.pages} trang` : 'KhÃ´ng rÃµ trang'}</span>
                  <div class="chapter-row-actions">
                    <span class="chapter-badge ${accessBadgeClass}">${accessBadgeText}</span>
                  </div>
                </div>
              </div>
            `;
          }).join("")
        }
      </div>

      <div class="drawer-actions">
        <button id="download-selected-btn" class="btn btn-primary" ${chapters.length === 0 ? 'disabled' : ''}>
          <i class="fa-solid fa-download"></i> Táº£i cÃ¡c chÆ°Æ¡ng Ä‘Ã£ chá»n
        </button>
      </div>
    `;


    document.querySelectorAll(".chapter-row").forEach(row => {
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("chapter-checkbox")) return;
        const cb = row.querySelector(".chapter-checkbox");
        if (cb && !cb.disabled) { cb.checked = !cb.checked; }
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
        alert("Vui lÃ²ng chá»n Ã­t nháº¥t má»™t chÆ°Æ¡ng truyá»‡n cÃ´ng khai Ä‘á»ƒ táº£i!");
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
    log(`Lá»—i láº¥y danh sÃ¡ch chÆ°Æ¡ng: ${err.message}`, "error");
    drawerContent.innerHTML = `
      <div class="empty-queue-msg" style="color: var(--danger)">
        <i class="fa-solid fa-circle-exclamation"></i>
        <p>Lá»—i táº£i danh sÃ¡ch chÆ°Æ¡ng: ${err.message}</p>
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
  log(`Thay Ä‘á»•i cÃ i Ä‘áº·t táº£i song song: ${concurrencySelect.value} chapter(s).`, "system");
  downloadQueue.process();
});

function convertToPngBlob(imageBlob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageBlob);

    const timeoutId = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("Timeout khi chuyá»ƒn Ä‘á»•i sang PNG."));
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
            reject(new Error("canvas.toBlob tráº£ vá» null."));
          }
        }, "image/png");
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      reject(new Error("KhÃ´ng thá»ƒ load hÃ¬nh áº£nh vÃ o canvas. Äá»‹nh dáº¡ng áº£nh cÃ³ thá»ƒ khÃ´ng há»£p lá»‡."));
    };

    img.src = url;
  });
}

function showConfirmDownloadModal(manga, selectedChapters) {
  confirmMangaTitle.innerText = manga.title;
  confirmChaptersCount.innerText = `ÄÃ£ chá»n ${selectedChapters.length} chÆ°Æ¡ng truyá»‡n`;

  confirmChaptersList.innerHTML = selectedChapters.map(ch => `
    <div class="confirm-chapter-item">
      <i class="fa-solid fa-file-image"></i>
      <span>ChÆ°Æ¡ng ${ch.numberText} ${ch.title ? `- ${ch.title}` : ''}</span>
    </div>
  `).join("");


  modalConcurrencySelect.value = concurrencySelect.value;
  modalFormatSelect.value = formatSelect.value;


  confirmModalOverlay.classList.add("active");
  confirmDownloadModal.classList.add("active");


  const onStartDownload = () => {

    concurrencySelect.value = modalConcurrencySelect.value;
    formatSelect.value = modalFormatSelect.value;


    log(`Báº¯t Ä‘áº§u tiáº¿n trÃ¬nh táº£i. CÃ i Ä‘áº·t: ${concurrencySelect.value} chapter(s) song song, Äá»‹nh dáº¡ng: ${formatSelect.value.toUpperCase()}`, "system");


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
// Initialize on load
(function init() {
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
      log("ÄÃ£ cáº­p nháº­t Proxy. Äang lÃ m má»›i trang...", "system");
      setTimeout(() => { window.location.reload(); }, 1000);
    });
  }
})();
