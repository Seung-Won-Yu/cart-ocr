/**
 * CartOCR Scraper - Background Service Worker (Manifest V3)
 * CORS 정책을 완전히 우회하고, 414 Request-URI Too Long 에러를 막기 위해
 * 탭을 띄운 뒤 localStorage에 데이터를 직접 주입해 주는 중계 서버
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetch_image") {
        fetchImageAsBase64(request.url)
            .then(base64 => {
                sendResponse({ success: true, data: base64 });
            })
            .catch(error => {
                console.error("백그라운드 이미지 처리 오류:", error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // 비동기 응답
    }
    
    // 414 URL 초과 오류를 우회하여 로컬 스토리지에 데이터를 강제 주입하는 액션
    if (request.action === "open_app_and_send_data") {
        openAppAndInjectStorage(request.data)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(err => {
                console.error("로컬 스토리지 주입 오류:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }
});

async function fetchImageAsBase64(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("네트워크 응답 오류");
        
        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        
        return `data:${contentType};base64,${base64}`;
    } catch (e) {
        console.warn(`백그라운드 이미지 다운로드 실패 (${url}):`, e);
        return "";
    }
}

/**
 * CartOCR 웹 앱 탭을 열고, 로딩이 완료되면 localStorage에 대용량 JSON 데이터를 주입하는 비동기 컨트롤러
 */
async function openAppAndInjectStorage(dataString) {
    return new Promise((resolve, reject) => {
        // 1. 웹 앱 탭 띄우기
        chrome.tabs.create({ url: "https://seung-won-yu.github.io/cart-ocr/?v=1.6" }, (tab) => {
            if (!tab) {
                reject(new Error("새 탭을 생성할 수 없습니다."));
                return;
            }

            // 2. 탭 로드가 완수될 때까지 기다리는 리스너 등록
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === tab.id && info.status === 'complete') {
                    // 리스너가 중복 실행되지 않게 즉시 제거
                    chrome.tabs.onUpdated.removeListener(listener);

                    // 3. 브라우저 스토리지에 강제 데이터 라이팅 스크립트 실행
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (data) => {
                            try {
                                localStorage.setItem('scraped_cart_data', data);
                                // 데이터를 감지할 수 있도록 페이지 새로고침 트리거
                                window.location.reload();
                            } catch (e) {
                                console.error("ExecuteScript localStorage 에러:", e);
                            }
                        },
                        args: [ dataString ]
                    }, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve();
                        }
                    });
                }
            });
        });
    });
}
