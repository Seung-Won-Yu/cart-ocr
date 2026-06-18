const http = require("http");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8"
};

function serveFile(request, response) {
    const url = new URL(request.url, "http://localhost");
    const filePath = path.normalize(path.join(rootDir, decodeURIComponent(url.pathname)));

    if (!filePath.startsWith(rootDir)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(404);
            response.end("Not found");
            return;
        }

        response.writeHead(200, {
            "content-type": mimeTypes[path.extname(filePath)] || "text/plain; charset=utf-8"
        });
        response.end(content);
    });
}

function dumpDom(url) {
    return new Promise((resolve, reject) => {
        const profileDir = `/tmp/cart-ocr-chrome-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        execFile(chromePath, [
            "--headless=new",
            "--disable-gpu",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-extensions",
            "--no-first-run",
            `--user-data-dir=${profileDir}`,
            "--host-resolver-rules=MAP www.devicemart.co.kr 127.0.0.1,MAP cart.coupang.com 127.0.0.1",
            "--virtual-time-budget=5000",
            "--dump-dom",
            url
        ], { maxBuffer: 1024 * 1024 * 5, timeout: 12000 }, (error, stdout, stderr) => {
            fs.rm(profileDir, { recursive: true, force: true }, () => {});
            if (stdout && stdout.includes("</html>")) {
                resolve(stdout);
                return;
            }
            if (error) {
                error.message += `\n${stderr}`;
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

function extractResult(html) {
    const match = html.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    if (!match) throw new Error("No test result found in dumped DOM");
    return JSON.parse(match[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&"));
}

function extractPass(html) {
    const match = html.match(/<pre id="result"[^>]*data-pass="([^"]+)"/);
    if (!match) throw new Error("No data-pass result found in dumped DOM");
    return match[1] === "true";
}

async function main() {
    const server = http.createServer(serveFile);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    const { port } = server.address();
    const cases = [
        {
            name: "devicemart",
            url: `http://www.devicemart.co.kr:${port}/tests/content-parser.test.html?fixture=devicemart`,
            type: "json"
        },
        {
            name: "coupang",
            url: `http://cart.coupang.com:${port}/tests/content-parser.test.html?fixture=coupang`,
            type: "json"
        },
        {
            name: "devicemart-line-total",
            url: `http://www.devicemart.co.kr:${port}/tests/devicemart-cart-fixture.html`,
            type: "pass"
        },
        {
            name: "devicemart-bruteforce-line-total",
            url: `http://www.devicemart.co.kr:${port}/tests/devicemart-bruteforce-fixture.html`,
            type: "pass"
        },
        {
            name: "versioned-action",
            url: `http://www.devicemart.co.kr:${port}/tests/versioned-action-fixture.html`,
            type: "pass"
        }
    ];

    try {
        for (const testCase of cases) {
            const html = await dumpDom(testCase.url);
            if (testCase.type === "json") {
                const result = extractResult(html);
                if (!result.ok) {
                    throw new Error(`${result.fixture} failed: ${result.error}`);
                }
            } else if (!extractPass(html)) {
                throw new Error(`${testCase.name} failed`);
            }
            console.log(`${testCase.name}: ok`);
        }
    } finally {
        server.close();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
