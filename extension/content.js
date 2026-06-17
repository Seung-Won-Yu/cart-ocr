/**
 * CartOCR Scraper - Content Script
 * 핫링크 회피, CORS 우회 및 상품 이미지 저장소 Whitelist 매칭 로직이 탑재된 최종 V6 스크래퍼
 */

var CART_OCR_SCRAPE_ACTION = "scrape_cart_v3";

if (!window.__cartOcrRegisteredActions) {
    window.__cartOcrRegisteredActions = {};
}

if (!window.__cartOcrRegisteredActions[CART_OCR_SCRAPE_ACTION]) {
    window.__cartOcrRegisteredActions[CART_OCR_SCRAPE_ACTION] = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === CART_OCR_SCRAPE_ACTION) {
            scrapeCurrentCart()
                .then(result => {
                    sendResponse({ success: true, items: result });
                })
                .catch(error => {
                    console.error("CartOCR 파싱 중 오류:", error);
                    sendResponse({ success: false, error: error.message });
                });
        }
        return true; // 비동기 응답 필수
    });
}

async function scrapeCurrentCart() {
    let items = [];
    const debugLog = [];

    if (isKnownEmptyCartPage()) {
        return [];
    }

    // 1단계: 쇼핑몰 솔루션별 맞춤형 하드코딩 파서 우선 작동 (고도몰, Cafe24 등)
    try {
        items = await parseKnownMallCart(debugLog);
        if (items && items.length > 0) {
            console.log("1단계 맞춤형 파서 성공:", items);
            return items;
        }
    } catch (e) {
        debugLog.push(`1단계 실패: ${e.message}`);
    }

    // 2단계: 스마트 범용 테이블 파서 작동
    try {
        items = await parseGenericTableCart(debugLog);
        if (items && items.length > 0) {
            console.log("2단계 범용 테이블 파서 성공:", items);
            return items;
        }
    } catch (e) {
        debugLog.push(`2단계 실패: ${e.message}`);
    }

    // 3단계: Div 기반 스크래퍼 작동 (테이블이 없을 때)
    try {
        items = await parseDivBasedCart(debugLog);
        if (items && items.length > 0) {
            console.log("3단계 Div 기반 파서 성공:", items);
            return items;
        }
    } catch (e) {
        debugLog.push(`3단계 실패: ${e.message}`);
    }

    // 4단계: 무차별 텍스트 매칭 파서 (Brute Force Parser) - 최후의 수단
    try {
        items = await parseBruteForceCart(debugLog);
        if (items && items.length > 0) {
            console.log("4단계 최후의 무차별 파서 성공:", items);
            return items;
        }
    } catch (e) {
        debugLog.push(`4단계 실패: ${e.message}`);
    }

    const totalTables = document.querySelectorAll('table').length;
    const totalDivs = document.querySelectorAll('div').length;
    const errMsg = `장바구니 품목을 찾지 못했습니다.\n[시스템 진단]: 테이블 ${totalTables}개 / 디브 ${totalDivs}개 감지.\n[실패 로그]: ${debugLog.join(' -> ')}`;
    throw new Error(errMsg);
}

function isKnownEmptyCartPage() {
    const text = document.body ? document.body.textContent : "";
    return /장바구니에\s*담긴\s*상품이\s*없습니다|장바구니가\s*비어|장바구니가\s*비었습니다/.test(text);
}

/**
 * 이미지 엘리먼트의 모든 속성을 스캔하여 진짜 상품 이미지 경로를 찾아내는 무차별 색출 함수 (Whitelist 기반 정밀 타격)
 */
function resolveImageUrl(imgEl) {
    if (!imgEl) return "";
    
    const attrs = imgEl.attributes;
    let rawSrc = "";
    
    // 이미지 내 모든 HTML 속성들을 스캔
    for (let i = 0; i < attrs.length; i++) {
        const attrName = attrs[i].name;
        const attrVal = attrs[i].value.trim();

        for (const candidate of extractImageCandidates(attrVal)) {
            if (!looksLikeProductImageUrl(candidate)) continue;
            if (attrName === "src") {
                if (!rawSrc) rawSrc = candidate;
            } else {
                rawSrc = candidate;
                break; // LazyLoad 전용 속성 우선 매칭
            }
        }

        if (rawSrc && attrName !== "src") break;
    }
    
    // 루프를 돌고도 못 찾았다면 최종 수단으로 브라우저가 평가한 imgEl.src 사용 (Whitelist 체크)
    if (!rawSrc) {
        const fallbackSrc = imgEl.src;
        if (looksLikeProductImageUrl(fallbackSrc)) {
            rawSrc = fallbackSrc;
        }
    }
    
    if (!rawSrc || rawSrc.startsWith("data:image")) return "";
    
    try {
        // 상대 경로를 도메인이 합쳐진 절대 경로로 온전히 변환
        return new URL(rawSrc, window.location.href).href;
    } catch (e) {
        let cleanSrc = rawSrc;
        if (cleanSrc.startsWith("//")) {
            cleanSrc = "https:" + cleanSrc;
        }
        return cleanSrc;
    }
}

function extractImageCandidates(value) {
    if (!value || value.startsWith("data:image")) return [];
    return value
        .split(",")
        .map(part => part.trim().split(/\s+/)[0])
        .filter(Boolean)
        .filter(part => !part.startsWith("data:image"));
}

function looksLikeProductImageUrl(url) {
    if (!url || typeof url !== "string") return false;

    const lower = url.toLowerCase();
    if (lower.startsWith("data:image")) return false;
    if (/sprite|icon|btn|button|checkbox|blank|spacer|logo|loading|arrow|delete|close/.test(lower)) return false;

    const hasProductPath = lower.includes("/goods/") ||
                           lower.includes("/prod/") ||
                           lower.includes("/product/") ||
                           lower.includes("/shop/data/") ||
                           lower.includes("/goods_img/") ||
                           lower.includes("/item/") ||
                           lower.includes("/vendor_inventory/") ||
                           lower.includes("/thumbnails/");

    const hasImageExtension = /\.(jpe?g|png|webp|gif)(?:\?|#|$)/i.test(lower);
    const hasKnownImageHost = /coupangcdn\.com|devicemart\.co\.kr|eleparts\.co\.kr/i.test(lower);

    return hasProductPath || (hasImageExtension && hasKnownImageHost);
}

/**
 * 이미지 URL을 백그라운드 서비스 워커(CORS 무시 정책)에 요청하여 Base64로 안전하게 변환해 오는 비동기 함수
 */
async function convertImageToBase64(imgUrl) {
    if (!imgUrl) return "";
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "fetch_image", url: imgUrl }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn("백그라운드 통신 오류:", chrome.runtime.lastError.message);
                resolve("");
                return;
            }
            if (response && response.success) {
                resolve(response.data);
            } else {
                resolve("");
            }
        });
    });
}

/**
 * 1. 한국 주요 쇼핑몰 솔루션(고도몰, Cafe24 등) 규격 맞춤 파서
 */
async function parseKnownMallCart(debugLog) {
    const items = [];
    const url = window.location.href;

    if (url.includes("devicemart.co.kr")) {
        if (/장바구니에\s*담긴\s*상품이\s*없습니다|장바구니가\s*비어/.test(document.body.textContent)) {
            return [];
        }

        const rows = document.querySelectorAll("table tr, .order_table_type tbody tr, #cart_table tbody tr, .tbl_cart_list tbody tr");
        if (rows.length === 0) throw new Error("행 후보 없음");
        
        for (const row of rows) {
            const nameEl = row.querySelector("a[href*='goods_view'], td.subject a, .goods_name a, .prod_name, a[href*='goods/view']");
            if (!nameEl) continue;

            let name = nameEl.textContent.replace(/[\n\t]/g, "").trim();
            if (name.includes("삭제") || name.includes("변경") || name.length < 2) continue;

            const qtyInput = row.querySelector("input[name*='goodsCnt'], input[name*='qty'], input[id*='cnt'], .qty_input, input[type='number']");
            let quantity = 1;
            if (qtyInput) {
                quantity = parseInt(qtyInput.value, 10) || 1;
            } else {
                const qtyCell = row.querySelector("td:nth-child(4), td:nth-child(3)");
                if (qtyCell) quantity = parseInt(qtyCell.textContent.replace(/[^0-9]/g, ""), 10) || 1;
            }

            const cells = row.querySelectorAll("td");

            // 디바이스마트 장바구니의 "상품금액"은 단가가 아니라 수량이 반영된 행 금액입니다.
            const priceEl = row.querySelector(".goods_price, .price, td.price, span.price_value, strong.price, td.price_cell");
            let amount = priceEl ? extractPriceFromText(priceEl.textContent) : 0;
            if (!amount) {
                amount = extractLineAmountFromRowCells(cells, {
                    skipElements: [nameEl]
                });
            }
            let price = amount ? deriveUnitPrice(amount, quantity) : 0;

            // 2차: 셀렉터 실패 시 → 행 내 모든 <td>를 순회하며 "원" 포함 셀에서 가격 추출
            if (price === 0) {
                price = extractUnitPriceFromRowCells(cells, quantity, {
                    skipElements: [nameEl],
                    qtyIndexes: []
                });
            }

            // 첫 번째 td(보통 체크박스)는 건너뛰고 이미지 찾기
            let imgEl = null;
            for (let i = 1; i < cells.length; i++) {
                imgEl = cells[i].querySelector("img");
                if (imgEl) {
                    const temp = resolveImageUrl(imgEl);
                    if (temp) {
                        break; // 유효한 상품 이미지 획득 시 중단
                    } else {
                        imgEl = null;
                    }
                }
            }
            if (!imgEl) {
                imgEl = row.querySelector("img");
            }
            
            const imageUrl = resolveImageUrl(imgEl);
            const image = await convertImageToBase64(imageUrl);

            if (!amount) amount = price * quantity;
            if (name && price > 0) {
                items.push({
                    name,
                    price,
                    quantity,
                    amount,
                    image,
                    sourceMall: "devicemart",
                    priceKind: "line-total-derived",
                    sourceLineAmount: amount
                });
            }
        }
    } else if (url.includes("coupang.com")) {
        const dealRows = document.querySelectorAll(".cart-deal-item");
        for (const row of dealRows) {
            const nameEl = row.querySelector(".product-name, .item-title");
            if (!nameEl) continue;
            const name = nameEl.textContent.replace(/[\n\t]/g, "").trim();

            const qtyInput = row.querySelector(".quantity-select, .quantity-input, input[name='quantity']");
            let quantity = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;

            const priceEl = row.querySelector(".unit-price, .discount-price, .price-area .price");
            let price = priceEl ? extractPriceFromText(priceEl.textContent) : 0;

            const imgEl = row.querySelector("img.product-img, .cart-deal-item__img img");
            const imageUrl = resolveImageUrl(imgEl);
            const image = await convertImageToBase64(imageUrl);

            const amount = price * quantity;
            items.push({ name, price, quantity, amount, image });
        }

        if (items.length === 0) {
            return parseCoupangVisualCart();
        }
    }

    return items;
}

async function parseCoupangVisualCart() {
    const items = [];
    const wrappers = [];
    const images = Array.from(document.querySelectorAll("img"));

    for (const img of images) {
        const imageUrl = resolveImageUrl(img);
        if (!imageUrl) continue;

        const wrapper = findSmallestPricedWrapper(img);
        if (!wrapper || wrappers.some(existing => existing === wrapper || existing.contains(wrapper) || wrapper.contains(existing))) continue;
        if (!hasCartQuantityControl(wrapper)) continue;

        wrappers.push(wrapper);
    }

    for (const wrapper of wrappers) {
        const name = extractCoupangName(wrapper);
        const price = extractCoupangPrice(wrapper);
        const quantity = extractQuantityFromContainer(wrapper);
        const imgEl = wrapper.querySelector("img");
        const imageUrl = resolveImageUrl(imgEl);
        const image = await convertImageToBase64(imageUrl);

        if (name && price > 0) {
            items.push({
                name,
                price,
                quantity,
                amount: price * quantity,
                image
            });
        }
    }

    return items;
}

function findSmallestPricedWrapper(startEl) {
    let el = startEl.parentElement;
    while (el && el !== document.body) {
        const text = el.textContent.replace(/\s+/g, " ").trim();
        if (/(원|₩)/.test(text) && hasCartQuantityControl(el) && text.length > 20 && text.length <= 900) return el;
        el = el.parentElement;
    }

    return null;
}

function hasCartQuantityControl(container) {
    if (container.querySelector("input[type='number'], input[type='text'], select")) return true;

    const text = container.textContent.replace(/\s+/g, " ");
    return /[−-]\s*\d{1,3}\s*\+/.test(text);
}

function extractCoupangName(container) {
    const lines = getVisibleTextLines(container);
    const blocked = /옵션|도착|무료배송|로켓|만족|리뷰|삭제|쿠폰|적용|한달구매|개당|g당|kg당|ml당|배송|할인|^\d+$|^[+\-−]+$/;

    return lines.find(line => line.length >= 4 && !/(원|₩)/.test(line) && !blocked.test(line)) || "";
}

function extractCoupangPrice(container) {
    const lines = getVisibleTextLines(container);
    let price = 0;

    for (const line of lines) {
        if (!/(원|₩)/.test(line)) continue;
        if (/개당|g당|kg당|ml당|당\s*[0-9,]+\s*원|쿠폰할인|배송비/.test(line)) continue;

        const matches = line.match(/[0-9,]+\s*(?:원|₩)/g);
        if (!matches) continue;

        const values = matches
            .map(match => parseInt(match.replace(/[^0-9]/g, ""), 10))
            .filter(value => value >= 100);

        if (values.length > 0) price = values[values.length - 1];
    }

    return price;
}

function extractQuantityFromContainer(container) {
    const input = container.querySelector("input[type='number'], input[type='text'], select");
    if (input) return parseInt(input.value, 10) || 1;

    const text = container.textContent.replace(/\s+/g, " ");
    const stepperMatch = text.match(/[−-]\s*(\d{1,3})\s*\+/);
    if (stepperMatch) return parseInt(stepperMatch[1], 10) || 1;

    return 1;
}

function getVisibleTextLines(container) {
    const lines = [];
    const walk = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;

    while (node = walk.nextNode()) {
        const text = node.textContent.replace(/\s+/g, " ").trim();
        if (text) lines.push(text);
    }

    return lines;
}

/**
 * 2. 범용 테이블 파서
 */
async function parseGenericTableCart(debugLog) {
    const tables = document.querySelectorAll("table");
    if (tables.length === 0) throw new Error("테이블 없음");
    
    let targetTable = null;
    let nameIdx = -1, qtyIdx = -1, priceIdx = -1, amountIdx = -1, imgIdx = -1;

    for (const table of tables) {
        const headers = table.querySelectorAll("th, td");
        let hasProductHeader = false;
        let hasQtyHeader = false;
        let hasPriceHeader = false;

        headers.forEach((header, idx) => {
            const text = header.textContent.replace(/\s+/g, "").trim();
            if (/상품|품명|품목|subject|product|item/i.test(text)) hasProductHeader = true;
            if (/수량|qty|quantity|ea/i.test(text) && !/금액|합계/i.test(text)) hasQtyHeader = true;
            if (/단가|가격|상품금액|판매가|금액|price|unitprice/i.test(text)) hasPriceHeader = true;
        });

        if (hasProductHeader && (hasQtyHeader || hasPriceHeader)) {
            targetTable = table;
            break;
        }
    }

    if (!targetTable) {
        targetTable = tables[0];
    }

    const headerRow = targetTable.querySelector("thead tr, tr:first-child");
    if (!headerRow) throw new Error("테이블 헤더 없음");
    
    const headerCells = headerRow.querySelectorAll("th, td");
    headerCells.forEach((cell, idx) => {
        const text = cell.textContent.replace(/\s+/g, "").trim();
        if (/상품|품명|품목|명칭|subject|product|item/i.test(text) && nameIdx === -1) nameIdx = idx;
        if (/수량|qty|quantity|ea/i.test(text) && !/금액|합계/i.test(text) && qtyIdx === -1) qtyIdx = idx;
        if (isUnitPriceHeader(text) && priceIdx === -1) priceIdx = idx;
        if (isAmountHeader(text) && amountIdx === -1) amountIdx = idx;
        if (/이미지|사진|image|thumb/i.test(text) && imgIdx === -1) imgIdx = idx;
    });

    if (nameIdx === -1) nameIdx = 1;
    if (qtyIdx === -1) qtyIdx = 2;
    if (priceIdx === -1 && amountIdx === -1) priceIdx = 3;

    const items = [];
    const rows = targetTable.querySelectorAll("tbody tr, tr");
    
    for (const row of rows) {
        if (row === headerRow || row.querySelector("th") || row.classList.contains("total-row") || row.classList.contains("sum-row")) {
            continue;
        }

        const cells = row.querySelectorAll("td");
        if (cells.length <= Math.max(nameIdx, qtyIdx, priceIdx, amountIdx)) continue;

        try {
            const nameCell = cells[nameIdx];
            const nameLink = nameCell.querySelector("a, span, p");
            let name = nameLink ? nameLink.textContent : nameCell.textContent;
            name = name.replace(/[\n\t\r]/g, "").replace(/\s+/g, " ").trim();
            if (name.includes("삭제") || name.includes("변경") || name.length < 2) continue;

            const qtyCell = cells[qtyIdx];
            const qtyInput = qtyCell.querySelector("input, select");
            let quantity = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : (parseInt(qtyCell.textContent.replace(/[^0-9]/g, ""), 10) || 1);

            const priceCell = priceIdx !== -1 ? cells[priceIdx] : null;
            const amountCell = amountIdx !== -1 ? cells[amountIdx] : null;
            let price = priceCell ? extractUnitPriceFromPriceElement(priceCell, quantity) : 0;

            if (price === 0 && amountCell) {
                const totalAmount = extractPriceFromText(amountCell.textContent);
                price = deriveUnitPrice(totalAmount, quantity);
            }

            // 매핑된 컬럼에서 가격 추출 실패 시 → 행 내 "원" 포함 셀 스캔
            if (price === 0) {
                price = extractUnitPriceFromRowCells(cells, quantity, {
                    skipElements: [nameCell],
                    qtyIndexes: [qtyIdx]
                });
            }

            let imgEl = null;
            if (imgIdx !== -1 && cells[imgIdx]) {
                imgEl = cells[imgIdx].querySelector("img");
            }
            if (!imgEl) {
                // 첫번째 td(체크박스)를 피해 이미지 검색
                for (let i = 1; i < cells.length; i++) {
                    imgEl = cells[i].querySelector("img");
                    if (imgEl) {
                        const temp = resolveImageUrl(imgEl);
                        if (temp) break;
                        else imgEl = null;
                    }
                }
            }
            const imageUrl = resolveImageUrl(imgEl);
            const image = await convertImageToBase64(imageUrl);

            const amount = amountCell ? extractPriceFromText(amountCell.textContent) || price * quantity : price * quantity;
            if (name && price > 0) {
                items.push({ name, price, quantity, amount, image });
            }
        } catch (err) {}
    }

    return items;
}

/**
 * 3. Div 기반 스크래퍼
 */
async function parseDivBasedCart(debugLog) {
    const items = [];
    const cartItemContainers = document.querySelectorAll("[class*='cart-item'], [class*='cart_item'], [class*='goods-item'], [class*='order-item']");
    if (cartItemContainers.length === 0) throw new Error("Div 컨테이너 없음");

    for (const container of cartItemContainers) {
        try {
            const nameEl = container.querySelector("[class*='name'], [class*='title'], a");
            if (!nameEl) continue;
            const name = nameEl.textContent.replace(/[\n\t]/g, "").trim();
            if (name.length < 2 || name.includes("삭제") || name.includes("변경")) continue;

            const qtyInput = container.querySelector("input[type='text'], input[type='number'], [class*='qty'], [class*='count']");
            let quantity = 1;
            if (qtyInput) {
                quantity = parseInt(qtyInput.value, 10) || parseInt(qtyInput.textContent.replace(/[^0-9]/g, ""), 10) || 1;
            }

            const priceEl = container.querySelector("[class*='price'], [class*='amount']");
            let price = priceEl ? extractPriceFromText(priceEl.textContent) : 0;

            const imgEl = container.querySelector("img");
            const imageUrl = resolveImageUrl(imgEl);
            const image = await convertImageToBase64(imageUrl);

            const amount = price * quantity;
            if (name && price > 0) {
                items.push({ name, price, quantity, amount, image });
            }
        } catch (e) {}
    }

    return items;
}

/**
 * 4. 무차별 텍스트 매칭 파서 (Brute Force Parser) - 최후의 카드
 */
async function parseBruteForceCart(debugLog) {
    const items = [];
    const inputs = document.querySelectorAll("input[type='text'], input[type='number'], input[name*='qty'], input[name*='cnt'], input[name*='amount']");

    for (const input of inputs) {
        try {
            const val = parseInt(input.value, 10);
            if (isNaN(val) || val <= 0 || val > 1000) continue;

            let wrapper = input.closest("tr, li, [class*='item'], [class*='list']");
            if (!wrapper) continue;

            const links = wrapper.querySelectorAll("a");
            let bestName = "";
            links.forEach(link => {
                const txt = link.textContent.replace(/[\n\t]/g, "").trim();
                if (txt.length > bestName.length && !txt.includes("삭제") && !txt.includes("변경") && !txt.includes("수정")) {
                    bestName = txt;
                }
            });

            if (!bestName) {
                const nameNode = wrapper.querySelector("[class*='name'], [class*='title']");
                if (nameNode) bestName = nameNode.textContent.replace(/[\n\t]/g, "").trim();
            }

            if (!bestName || bestName.length < 2) continue;
            if (items.some(item => item.name === bestName)) continue;

            const textNodes = [];
            const walk = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while(node = walk.nextNode()) {
                textNodes.push(node.textContent.trim());
            }

            // "원" 표기가 있는 가격을 최우선 사용, 모델 넘버(123-456-789) 패턴은 제외
            let bestPrice = 0;
            let bestPriceHasWon = false;
            for (const txt of textNodes) {
                const trimmed = txt.trim();
                // 하이픈으로 연결된 모델 넘버 패턴은 건너뛰기
                if (/^\d+(-\d+)+$/.test(trimmed)) continue;
                
                const cleanTxt = trimmed.replace(/,/g, "");
                
                // "원" 표기가 있는 숫자를 최우선 매칭
                const wonMatch = cleanTxt.match(/([0-9]{3,8})\s*(?:원|₩)/);
                if (wonMatch) {
                    const priceVal = parseInt(wonMatch[1], 10);
                    if (priceVal >= 100) {
                        // "원" 매칭 중 마지막 값 사용 (할인가가 보통 뒤에 위치)
                        bestPrice = priceVal;
                        bestPriceHasWon = true;
                    }
                    continue;
                }
                
                // "원" 매칭이 아직 없을 때만 순수 숫자 폴백
                if (!bestPriceHasWon) {
                    const plainMatch = cleanTxt.match(/([0-9]{3,8})/);
                    if (plainMatch) {
                        const priceVal = parseInt(plainMatch[1], 10);
                        if (priceVal >= 100 && priceVal > bestPrice) {
                            bestPrice = priceVal;
                        }
                    }
                }
            }

            // 래퍼 내에서 첫 번째 td가 아닌 곳에서 이미지 찾기 시도
            let imgEl = null;
            const cells = wrapper.querySelectorAll("td");
            if (cells.length > 1) {
                for (let i = 1; i < cells.length; i++) {
                    imgEl = cells[i].querySelector("img");
                    if (imgEl) {
                        const temp = resolveImageUrl(imgEl);
                        if (temp) break;
                        else imgEl = null;
                    }
                }
            }
            if (!imgEl) {
                imgEl = wrapper.querySelector("img");
            }

            const imageUrl = resolveImageUrl(imgEl);
            const image = await convertImageToBase64(imageUrl);

            const amount = bestPrice * val;
            if (bestName && bestPrice > 0) {
                items.push({
                    name: bestName,
                    price: bestPrice,
                    quantity: val,
                    amount: amount,
                    image: image
                });
            }
        } catch (e) {}
    }

    return items;
}

/**
 * 텍스트 데이터에서 실 단가(Price)를 안전하고 정밀하게 추출하는 헬퍼 함수
 * 할인 전 원래 가격과 할인 가격이 혼재하거나 수량 텍스트가 섞여 있을 때의 오차를 방지합니다.
 */
function extractPriceFromText(text) {
    if (!text) return 0;
    
    // 1. "원"이 붙은 숫자 뭉치들 최우선 검색 (예: "5,800,000원 7% 5,400,000원" → 5,400,000)
    const wonMatches = text.match(/[0-9,]+\s*원/g);
    if (wonMatches && wonMatches.length > 0) {
        const lastWon = wonMatches[wonMatches.length - 1];
        return parseInt(lastWon.replace(/[^0-9]/g, ""), 10) || 0;
    }
    
    // 2. 콤마 포맷된 숫자 (예: "5,400,000") — 거의 반드시 가격
    const commaMatches = text.match(/\d{1,3}(?:,\d{3})+/g);
    if (commaMatches && commaMatches.length > 0) {
        const prices = commaMatches.map(m => parseInt(m.replace(/,/g, ""), 10)).filter(n => n > 100);
        if (prices.length > 0) return prices[prices.length - 1];
    }
    
    // 3. 하이픈으로 연결된 모델 넘버 패턴 제거 후 독립 숫자만 추출
    //    예: "945-14070-0080-00" → 전체 제거, "BK-201 15000" → 15000만 추출
    const cleaned = text.replace(/\d+(?:-\d+){1,}/g, "");
    const numMatches = cleaned.match(/[0-9]+/g);
    if (numMatches && numMatches.length > 0) {
        const numbers = numMatches.map(m => parseInt(m, 10)).filter(n => n > 100);
        if (numbers.length > 0) return numbers[numbers.length - 1];
    }
    
    // 4. 최후의 보루
    return parseInt(text.replace(/[^0-9]/g, ""), 10) || 0;
}

function extractUnitPriceFromPriceElement(element, quantity) {
    if (!element) return 0;

    const rawPrice = extractPriceFromText(element.textContent);
    if (!rawPrice) return 0;

    const label = getElementLabel(element);
    if (isAmountText(label) && !isUnitPriceText(label)) {
        return deriveUnitPrice(rawPrice, quantity);
    }

    return rawPrice;
}

function extractLineAmountFromRowCells(cells, options = {}) {
    const skipElements = options.skipElements || [];

    for (const cell of cells) {
        if (!cell) continue;
        if (cell.querySelector("input[type='checkbox']")) continue;
        if (skipElements.some(el => el && cell.contains(el))) continue;

        const text = cell.textContent.trim();
        if (!/(원|₩)/.test(text)) continue;
        if (/배송|ship|쿠폰|할인|적립|point/i.test(text)) continue;

        const amount = extractPriceFromText(text);
        if (amount > 0) return amount;
    }

    return 0;
}

function extractUnitPriceFromRowCells(cells, quantity, options = {}) {
    const skipElements = options.skipElements || [];
    const qtyIndexes = options.qtyIndexes || [];
    const candidates = [];

    cells.forEach((cell, index) => {
        if (!cell || qtyIndexes.includes(index)) return;
        if (cell.querySelector("input[type='checkbox']")) return;
        if (skipElements.some(el => el && cell.contains(el))) return;

        const text = cell.textContent.trim();
        if (!/[0-9]/.test(text)) return;
        if (/배송|ship|쿠폰|할인|적립|point/i.test(text)) return;

        const rawPrice = extractPriceFromText(text);
        if (!rawPrice) return;

        const label = getElementLabel(cell);
        const isAmount = isAmountText(label) && !isUnitPriceText(label);
        const unitPrice = isAmount ? deriveUnitPrice(rawPrice, quantity) : rawPrice;

        candidates.push({
            unitPrice,
            isExplicitUnit: isUnitPriceText(label),
            isAmount
        });
    });

    const explicitUnit = candidates.find(candidate => candidate.isExplicitUnit && candidate.unitPrice > 0);
    if (explicitUnit) return explicitUnit.unitPrice;

    const nonAmount = candidates.filter(candidate => !candidate.isAmount && candidate.unitPrice > 0);
    if (nonAmount.length > 0) {
        return nonAmount[0].unitPrice;
    }

    const amountBased = candidates.find(candidate => candidate.isAmount && candidate.unitPrice > 0);
    return amountBased ? amountBased.unitPrice : 0;
}

function deriveUnitPrice(amount, quantity) {
    if (!amount) return 0;
    const qty = parseInt(quantity, 10) || 1;
    if (qty <= 1) return amount;
    return Math.round(amount / qty);
}

function getElementLabel(element) {
    return `${element.textContent || ""} ${element.className || ""} ${element.id || ""}`.replace(/\s+/g, " ").trim();
}

function isUnitPriceHeader(text) {
    return isUnitPriceText(text) && !/합계|총|주문금액|결제금액|소계|amount|total|subtotal|sum/i.test(text || "");
}

function isAmountHeader(text) {
    return /금액|합계|총액|소계|amount|total|subtotal|sum/i.test(text) && !isUnitPriceHeader(text);
}

function isUnitPriceText(text) {
    return /단가|판매가|가격|price|unit|cost|goods_price|price_value|price_cell/i.test(text || "");
}

function isAmountText(text) {
    return /금액|합계|총|주문금액|결제금액|amount|total|subtotal|sum/i.test(text || "");
}
