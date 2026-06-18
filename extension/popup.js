/**
 * CartOCR Scraper - Popup Control Script
 */

const CART_OCR_SCRAPE_ACTION = "scrape_cart_v9";

document.addEventListener('DOMContentLoaded', async () => {
    const statusContainer = document.getElementById('status-container');
    const statusDot = document.getElementById('status-dot');
    const statusLabel = document.getElementById('status-label');
    const statusDesc = document.getElementById('status-desc');
    const scrapeBtn = document.getElementById('scrape-btn');
    const sendBtn = document.getElementById('send-btn');

    let activeTab = null;
    let scrapedItems = [];
    let scrapedCartPayload = null;

    // 현재 활성화된 탭 조회 및 지원 쇼핑몰 판별
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0]) {
            activeTab = tabs[0];
            const url = activeTab.url;

            if (isCoupangCartUrl(url)) {
                setScrapeStatus("active", "쿠팡 장바구니 감지됨", "현재 쿠팡 장바구니 페이지를 보고 있습니다.");
                scrapeBtn.disabled = false;
            } else if (url.includes("coupang.com")) {
                setScrapeStatus("warning", "쿠팡 페이지 감지됨", "장바구니 페이지(Carts)로 이동 시 즉시 연동됩니다.");
            } else if (url.includes("devicemart.co.kr/goods/cart") || url.includes("devicemart.co.kr")) {
                setScrapeStatus("active", "디바이스마트 감지됨", "디바이스마트에서 상품 수집이 가능합니다.");
                scrapeBtn.disabled = false;
            } else if (url.includes("eleparts.co.kr/main/cart") || url.includes("eleparts.co.kr")) {
                setScrapeStatus("active", "엘레파츠 감지됨", "엘레파츠에서 상품 수집이 가능합니다.");
                scrapeBtn.disabled = false;
            } else {
                setScrapeStatus("inactive", "연동 가능한 쇼핑몰 아님", "쿠팡, 디바이스마트, 엘레파츠 장바구니로 가보세요.");
            }
        }
    } catch (e) {
        console.error("탭 로드 오류:", e);
        setScrapeStatus("inactive", "오류 발생", "브라우저 상태를 읽지 못했습니다.");
    }

    // 상태값 UI 업데이트 헬퍼
    function setScrapeStatus(type, title, desc) {
        statusContainer.className = "status-box";
        if (type === "active") {
            statusContainer.classList.add("status-active");
            statusDot.style.backgroundColor = "var(--success)";
        } else if (type === "warning") {
            statusDot.style.backgroundColor = "#f59e0b";
        } else {
            statusDot.style.backgroundColor = "#94a3b8";
        }
        statusLabel.textContent = title;
        statusDesc.textContent = desc;
    }

    // [장바구니 상품 수집] 버튼 클릭 핸들러
    scrapeBtn.addEventListener('click', async () => {
        if (!activeTab) return;

        scrapeBtn.disabled = true;
        statusDesc.textContent = "웹페이지 구조(DOM) 파싱 및 이미지 Base64 인코딩 중...";

        try {
            const response = await requestCartScrape(activeTab.id);
            scrapeBtn.disabled = false;

            if (response && response.success) {
                scrapedItems = response.items || [];
                scrapedCartPayload = {
                    items: scrapedItems,
                    summary: response.summary || null
                };
                if (scrapedItems.length > 0) {
                    const firstItem = scrapedItems[0];
                    const summaryLine = response.summary && response.summary.vat
                        ? `<br>부가세 <strong>${formatWon(response.summary.vat)}</strong> / 결제예정 <strong>${formatWon(response.summary.grandTotal)}</strong><br>`
                        : "";
                    statusDesc.innerHTML = `총 <strong>${scrapedItems.length}개</strong> 수집 완료<br>` +
                        `첫 항목: 단가 <strong>${formatWon(firstItem.price)}</strong> / 합계 <strong>${formatWon(firstItem.amount)}</strong><br>` +
                        summaryLine +
                        `화면 반영은 아래 <strong>CartOCR 앱으로 전송</strong>을 눌러주세요.`;
                    sendBtn.disabled = false;
                } else {
                    statusDesc.textContent = "감지된 장바구니 상품 품목이 없습니다. 장바구니에 담긴 물품이 있는지 확인해 주세요.";
                }
            } else {
                statusDesc.textContent = "수집 실패: " + (response ? response.error : "알 수 없는 에러");
            }
        } catch (error) {
            console.error(error);
            scrapeBtn.disabled = false;
            statusDesc.textContent = "수집 실패: " + error.message;
        }
    });

    // [CartOCR 앱으로 전송] 버튼 클릭 핸들러
    sendBtn.addEventListener('click', () => {
        if (scrapedItems.length === 0) return;

        scrapeBtn.disabled = true;
        sendBtn.disabled = true;
        statusDesc.textContent = "대용량 데이터를 앱 스토리지에 주입하는 중...";

        // 백그라운드 서비스 워커에 대리 전송 및 스토리지 라이팅 위임 요청
        chrome.runtime.sendMessage({ 
            action: "open_app_and_send_data", 
            data: JSON.stringify(scrapedCartPayload || scrapedItems)
        }, (response) => {
            scrapeBtn.disabled = false;
            sendBtn.disabled = false;
            
            if (chrome.runtime.lastError) {
                alert("연동 에러: " + chrome.runtime.lastError.message);
                return;
            }
            
            if (response && response.success) {
                window.close(); // 성공 시 익스텐션 팝업을 닫음
            } else {
                alert("연동 실패: " + (response ? response.error : "알 수 없는 에러"));
            }
        });
    });

    async function requestCartScrape(tabId) {
        statusDesc.textContent = "최신 수집 스크립트 연결 중...";
        await injectScraper(tabId);
        return sendScrapeMessage(tabId);
    }

    async function injectScraper(tabId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ["content.js"]
            });
        } catch (error) {
            if (!isMissingContentScriptError(error)) throw error;
        }
    }

    function sendScrapeMessage(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { action: CART_OCR_SCRAPE_ACTION }, (response) => {
                const runtimeError = chrome.runtime.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message));
                    return;
                }

                resolve(response);
            });
        });
    }

    function isMissingContentScriptError(error) {
        return /receiving end does not exist|could not establish connection/i.test(error.message || "");
    }

    function formatWon(value) {
        const number = parseInt(value, 10) || 0;
        return number.toLocaleString("ko-KR") + "원";
    }

    function isCoupangCartUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return parsedUrl.hostname.endsWith("coupang.com") &&
                (parsedUrl.pathname.includes("/vp/carts") || parsedUrl.pathname.includes("/cartView.pang"));
        } catch (error) {
            return url.includes("coupang.com/vp/carts") || url.includes("cart.coupang.com/cartView.pang");
        }
    }
});
