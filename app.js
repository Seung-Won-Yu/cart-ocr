/**
 * CartOCR - Core Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // State Variables
    let currentItems = [];
    let currentCartSummary = null;

    // DOM Elements
    const themeToggleBtn = document.getElementById('theme-toggle');
    
    const tableBody = document.getElementById('table-body');
    const subtotalRowContainer = document.getElementById('subtotal-row-container');
    const subtotalPriceEl = document.getElementById('subtotal-price');
    const vatRowContainer = document.getElementById('vat-row-container');
    const vatPriceEl = document.getElementById('vat-price');
    const shippingRowContainer = document.getElementById('shipping-row-container');
    const shippingPriceEl = document.getElementById('shipping-price');
    const totalRowContainer = document.getElementById('total-row-container');
    const totalPriceEl = document.getElementById('total-price');
    const tableActionsContainer = document.getElementById('table-actions-container');
    const addRowBtn = document.getElementById('add-row-btn');
    
    const exportSection = document.getElementById('export-section');
    const copyMarkdownBtn = document.getElementById('copy-markdown-btn');
    const downloadCsvBtn = document.getElementById('download-csv-btn');
    const printDocBtn = document.getElementById('print-doc-btn');
    const printTableBody = document.getElementById('print-table-body');
    const printSubtotalRow = document.getElementById('print-subtotal-row');
    const printSubtotalPriceEl = document.getElementById('print-subtotal-price');
    const printVatRow = document.getElementById('print-vat-row');
    const printVatPriceEl = document.getElementById('print-vat-price');
    const printShippingRow = document.getElementById('print-shipping-row');
    const printShippingPriceEl = document.getElementById('print-shipping-price');
    const printTotalPriceEl = document.getElementById('print-total-price');
    const printDateEl = document.getElementById('print-date');

    // Init Theme
    if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeToggleBtn.querySelector('span').textContent = 'light_mode';
    }

    // localStorage에서 크롬 익스텐션이 주입해 준 장바구니 데이터 파싱 및 로드
    const rawData = localStorage.getItem('scraped_cart_data');
    if (rawData) {
        try {
            const parsedPayload = JSON.parse(rawData);
            const importedCart = normalizeImportedCartPayload(parsedPayload);
            if (importedCart.items.length > 0) {
                currentItems = importedCart.items;
                currentCartSummary = importedCart.summary;
                renderTable();
                
                // 로드 완료 후 로컬 스토리지 데이터 청소 (새 창으로 웹 앱을 다시 열 때 중복 로딩 방지)
                localStorage.removeItem('scraped_cart_data');
            }
        } catch (e) {
            console.error("로컬 스토리지 데이터 연동 오류:", e);
        }
    }

    // Toggle Theme
    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'dark') {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
            themeToggleBtn.querySelector('span').textContent = 'dark_mode';
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
            themeToggleBtn.querySelector('span').textContent = 'light_mode';
        }
    });



    // Render Table based on state
    function renderTable() {
        tableBody.innerHTML = '';
        
        if (currentItems.length === 0) {
            tableBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="6">
                        <span class="material-symbols-rounded empty-icon">extension</span>
                        <p>쇼핑몰 장바구니 페이지에서 <strong>CartOCR Scraper 익스텐션</strong>을 통해 품목을 전송해 주세요.</p>
                    </td>
                </tr>
            `;
            totalRowContainer.classList.add('hidden');
            setHidden(subtotalRowContainer, true);
            setHidden(vatRowContainer, true);
            setHidden(shippingRowContainer, true);
            tableActionsContainer.classList.add('hidden');
            exportSection.classList.add('hidden');
            return;
        }

        currentItems.forEach((item, index) => {
            const row = document.createElement('tr');
            row.dataset.index = index;

            row.innerHTML = `
                <td class="cell-image-container">
                    <img class="product-thumb" src="${item.image || 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=80&auto=format&fit=crop&q=60'}" alt="상품" referrerpolicy="no-referrer">
                </td>
                <td contenteditable="true" class="cell-name">${escapeHtml(item.name)}</td>
                <td contenteditable="true" class="cell-quantity text-right">${item.quantity}</td>
                <td contenteditable="true" class="cell-price text-right">${formatNumber(item.price)}</td>
                <td class="cell-amount text-right">${formatNumber(item.amount)}</td>
                <td>
                    <button class="btn-delete-row" data-index="${index}" title="삭제">
                        <span class="material-symbols-rounded">delete</span>
                    </button>
                </td>
            `;

            // 인라인 편집 바인딩
            row.querySelectorAll('td[contenteditable="true"]').forEach(cell => {
                cell.addEventListener('blur', (e) => handleCellBlur(e, index));
                cell.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        cell.blur();
                    }
                });
            });

            tableBody.appendChild(row);
        });

        // Event Listener for Delete row buttons
        tableBody.querySelectorAll('.btn-delete-row').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index, 10);
                currentItems.splice(index, 1);
                if (currentItems.length === 0) currentCartSummary = null;
                renderTable();
            });
        });

        // Update Total
        updateTotalSum();

        // Show UI elements
        totalRowContainer.classList.remove('hidden');
        tableActionsContainer.classList.remove('hidden');
        exportSection.classList.remove('hidden');
    }

    // Handle Inline Editing Blur
    function handleCellBlur(e, index) {
        const cell = e.target;
        const value = cell.textContent.trim();
        const item = currentItems[index];

        if (cell.classList.contains('cell-name')) {
            item.name = value;
        } else if (cell.classList.contains('cell-quantity')) {
            const qty = parseInt(value.replace(/,/g, ''), 10) || 0;
            item.quantity = qty;
            item.amount = item.price * qty;
            cell.textContent = qty;
            
            // 현재 행의 합계 셀 업데이트
            const row = cell.closest('tr');
            row.querySelector('.cell-amount').textContent = formatNumber(item.amount);
        } else if (cell.classList.contains('cell-price')) {
            const price = parseInt(value.replace(/,/g, ''), 10) || 0;
            item.price = price;
            item.amount = price * item.quantity;
            cell.textContent = formatNumber(price);
            
            // 현재 행의 합계 셀 업데이트
            const row = cell.closest('tr');
            row.querySelector('.cell-amount').textContent = formatNumber(item.amount);
        }

        updateTotalSum();
    }

    // Add Row
    addRowBtn.addEventListener('click', () => {
        currentItems.push({
            name: "새로운 제품 정보 입력",
            price: 0,
            quantity: 1,
            amount: 0,
            image: "https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=80&auto=format&fit=crop&q=60"
        });
        renderTable();
        
        // 새로 추가된 행의 첫번째 셀에 포커스
        const lastRow = tableBody.lastElementChild;
        if (lastRow) {
            const nameCell = lastRow.querySelector('.cell-name');
            nameCell.focus();
            
            // 전체 텍스트 셀렉트 효과
            const range = document.createRange();
            range.selectNodeContents(nameCell);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    });

    // Update Total Sum
    function updateTotalSum() {
        const totals = getCartTotals();
        setHidden(subtotalRowContainer, !totals.hasSummary);
        setHidden(vatRowContainer, !totals.hasSummary);
        setHidden(shippingRowContainer, !totals.hasSummary);

        if (subtotalPriceEl) subtotalPriceEl.textContent = formatNumber(totals.productTotal) + '원';
        if (vatPriceEl) vatPriceEl.textContent = formatNumber(totals.vat) + '원';
        if (shippingPriceEl) shippingPriceEl.textContent = formatNumber(totals.shipping) + '원';
        totalPriceEl.textContent = formatNumber(totals.grandTotal) + '원';
    }

    function normalizeImportedCartPayload(payload) {
        const rawItems = Array.isArray(payload) ? payload : (Array.isArray(payload && payload.items) ? payload.items : []);
        const items = normalizeImportedItems(rawItems);
        const summary = Array.isArray(payload) ? null : normalizeCartSummary(payload && payload.summary, items);

        return { items, summary };
    }

    function normalizeImportedItems(items) {
        return items.map((item) => {
            const quantity = Math.max(parseInteger(item.quantity, 1), 1);
            let amount = parseInteger(item.amount, 0);
            let price = parseInteger(item.price, 0);

            if (item.sourceMall === "devicemart" && item.priceKind === "line-total-derived") {
                amount = parseInteger(item.sourceLineAmount, amount);
                price = deriveUnitPrice(amount, quantity);
            } else {
                if (!amount && price) amount = price * quantity;
                if (!price && amount) price = deriveUnitPrice(amount, quantity);
            }

            return {
                ...item,
                quantity,
                price,
                amount
            };
        });
    }

    function normalizeCartSummary(summary, items) {
        if (!summary || typeof summary !== "object") return null;

        const productTotal = parseInteger(summary.productTotal || summary.itemSubtotal, 0);
        const vat = parseInteger(summary.vat || summary.tax, 0);
        const shipping = parseInteger(summary.shipping || summary.deliveryFee, 0);
        const grandTotal = parseInteger(summary.grandTotal || summary.total, 0);

        if (!productTotal && !vat && !shipping && !grandTotal) return null;

        const computedSubtotal = items.reduce((sum, item) => sum + item.amount, 0);
        const summarySubtotal = productTotal || computedSubtotal;
        const vatRate = summarySubtotal > 0 && vat > 0 ? vat / summarySubtotal : 0;

        return {
            sourceMall: summary.sourceMall || "",
            productTotal: summarySubtotal,
            vat,
            vatRate,
            shipping,
            grandTotal: grandTotal || summarySubtotal + vat + shipping
        };
    }

    function getCartTotals() {
        const productTotal = currentItems.reduce((sum, item) => sum + item.amount, 0);
        if (!currentCartSummary) {
            return {
                productTotal,
                vat: 0,
                shipping: 0,
                grandTotal: productTotal,
                hasSummary: false
            };
        }

        const vat = currentCartSummary.vatRate > 0 ? Math.round(productTotal * currentCartSummary.vatRate) : 0;
        const shipping = currentCartSummary.shipping || 0;
        const grandTotal = productTotal + vat + shipping;

        return {
            productTotal,
            vat,
            shipping,
            grandTotal,
            hasSummary: true
        };
    }

    function parseInteger(value, fallback = 0) {
        if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
        const parsed = parseInt(String(value || "").replace(/[^0-9-]/g, ""), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function deriveUnitPrice(amount, quantity) {
        const qty = parseInteger(quantity, 1) || 1;
        if (!amount || qty <= 1) return amount || 0;
        return Math.round(amount / qty);
    }

    function setHidden(element, shouldHide) {
        if (!element) return;
        element.classList.toggle('hidden', shouldHide);
    }

    // Format utility
    function formatNumber(num) {
        return num.toLocaleString();
    }

    function escapeHtml(string) {
        return String(string)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Export - Copy Markdown Table
    copyMarkdownBtn.addEventListener('click', () => {
        if (currentItems.length === 0) return;

        let md = `| 번호 | 품명 및 규격 | 수량 | 단가 (원) | 금액 (원) |\n`;
        md += `| --- | --- | ---: | ---: | ---: |\n`;
        
        currentItems.forEach((item, index) => {
            md += `| ${index + 1} | ${item.name} | ${item.quantity} | ${formatNumber(item.price)} | ${formatNumber(item.amount)} |\n`;
        });
        
        const totals = getCartTotals();
        if (totals.hasSummary) {
            md += `| 상품 주문 금액 | | | | ${formatNumber(totals.productTotal)} |\n`;
            md += `| 부가세 | | | | ${formatNumber(totals.vat)} |\n`;
            md += `| 배송비 | | | | ${formatNumber(totals.shipping)} |\n`;
        }
        md += `| **결제 예정금액** | | | | **${formatNumber(totals.grandTotal)}** |\n`;

        navigator.clipboard.writeText(md).then(() => {
            alert('노션/슬랙에 바로 붙여넣을 수 있는 Markdown 표 양식이 클립보드에 복사되었습니다.');
        }).catch(err => {
            alert('클립보드 복사 실패: ' + err);
        });
    });

    // Export - Download CSV
    downloadCsvBtn.addEventListener('click', () => {
        if (currentItems.length === 0) return;

        // 한글 깸 방지를 위한 BOM 적용 (UTF-8)
        let csvContent = "\uFEFF";
        csvContent += "번호,품명 및 규격,수량,단가,금액\n";

        currentItems.forEach((item, index) => {
            // 상품명 내의 쉼표(,) 처리
            const cleanName = item.name.includes(',') ? `"${item.name}"` : item.name;
            csvContent += `${index + 1},${cleanName},${item.quantity},${item.price},${item.amount}\n`;
        });

        const totals = getCartTotals();
        if (totals.hasSummary) {
            csvContent += `상품 주문 금액,,,,${totals.productTotal}\n`;
            csvContent += `부가세,,,,${totals.vat}\n`;
            csvContent += `배송비,,,,${totals.shipping}\n`;
        }
        csvContent += `결제 예정금액,,,,${totals.grandTotal}\n`;

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        // 날짜 파일명 생성
        const today = new Date().toISOString().slice(0, 10);
        link.setAttribute('href', url);
        link.setAttribute('download', `구매신청목록_${today}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // Export - Print & PDF Layout
    printDocBtn.addEventListener('click', () => {
        if (currentItems.length === 0) return;

        // 오늘 날짜 세팅
        const today = new Date();
        const formattedDate = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
        printDateEl.textContent = formattedDate;

        // 인쇄 테이블 렌더링
        printTableBody.innerHTML = '';
        currentItems.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center;">${index + 1}</td>
                <td style="text-align: center; padding: 4px;">
                    <img class="print-thumb" src="${item.image || 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=80&auto=format&fit=crop&q=60'}" alt="상품 이미지" referrerpolicy="no-referrer">
                </td>
                <td>${escapeHtml(item.name)}</td>
                <td style="text-align: right;">${item.quantity}</td>
                <td style="text-align: right;">${formatNumber(item.price)}원</td>
                <td style="text-align: right;">${formatNumber(item.amount)}원</td>
            `;
            printTableBody.appendChild(tr);
        });

        const totals = getCartTotals();
        setHidden(printSubtotalRow, !totals.hasSummary);
        setHidden(printVatRow, !totals.hasSummary);
        setHidden(printShippingRow, !totals.hasSummary);
        if (printSubtotalPriceEl) printSubtotalPriceEl.textContent = formatNumber(totals.productTotal) + '원';
        if (printVatPriceEl) printVatPriceEl.textContent = formatNumber(totals.vat) + '원';
        if (printShippingPriceEl) printShippingPriceEl.textContent = formatNumber(totals.shipping) + '원';
        printTotalPriceEl.textContent = formatNumber(totals.grandTotal) + '원';

        // 시스템 인쇄 팝업 노출
        window.print();
    });
});
