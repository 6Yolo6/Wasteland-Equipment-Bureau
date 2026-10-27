/** Real browser smoke check for a successful copied Creator build. Localhost only. */
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pollUntil } = require('./lib/async-poll.cjs');
const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'toolchains.local.json'), 'utf8'));
const { chromium } = require(path.join(config.browserAutomationModules, 'playwright'));
const evidencePath = path.resolve(ROOT, process.argv[2] || '');
const inside = (file, parent) => {
  const relative = path.relative(parent, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
assert(inside(evidencePath, path.join(ROOT, 'logs')), 'Build evidence must be inside workspace logs');
const build = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
assert.equal(build.status, 'BUILD_PASSED', 'A real successful build is required');
assert.equal(build.exit_code, 36);
const contentRoot = path.dirname(build.index_html);
assert(inside(contentRoot, path.join(ROOT, 'verification')), 'Serve only an isolated verification build');
const logs = path.join(path.dirname(evidencePath), 'browser-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(logs, { recursive: false });
const resultPath = path.join(logs, 'web-smoke-result.json');
assert(!fs.existsSync(resultPath), 'Preserve previous browser evidence');
const report = { started_at: new Date().toISOString(), scope: 'Local Chrome Web Mobile runtime and resize smoke only, NOT real mobile/TapTap/SDK/gameplay validation', build_evidence: evidencePath, checks: [], page_errors: [], console_errors: [], console_warnings: [], console_messages: [], request_failures: [], blocked_external_requests: [], http_errors: [], screenshots: [], status: 'NOT_RUN' };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(contentRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!inside(file, contentRoot)) { res.writeHead(403); res.end(); return; }
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (error) {
    report.http_errors.push({ url: req.url, error: error.code || error.message });
    res.writeHead(404); res.end('Not found');
  }
});
let browser, page;
(async () => {
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    report.origin = origin;
    console.log('LOCAL_SMOKE_ORIGIN=' + origin);
    browser = await chromium.launch({ executablePath: config.chrome, headless: true, chromiumSandbox: true, timeout: 30000 });
    report.browser_version = browser.version();
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await context.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin === origin) return route.continue();
      report.blocked_external_requests.push(request.url());
      return route.abort();
    });
    page = await context.newPage();
    page.on('pageerror', error => report.page_errors.push(error.message));
    page.on('console', message => {
      if (report.console_messages.length < 150) report.console_messages.push({ type: message.type(), text: message.text() });
      if (message.type() === 'error') report.console_errors.push(message.text());
      if (message.type() === 'warning') report.console_warnings.push(message.text());
    });
    page.on('requestfailed', request => report.request_failures.push({ url: request.url(), error: request.failure() }));
    const response = await page.goto(origin + '/', { waitUntil: 'load', timeout: 30000 });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => typeof System !== 'undefined' && typeof System.import === 'function', null, { timeout: 15000 });
    await pollUntil(() => page.evaluate(async () => {
      const cc = await System.import('cc');
      const scene = cc.director && cc.director.getScene();
      return !!scene && scene.name === 'Smoke' && !!scene.getChildByName('Canvas');
    }), { timeoutMs: 45000, label: 'real Smoke scene with Canvas' });
    async function runtimeState() {
      return page.evaluate(async () => {
        const cc = await System.import('cc');
        const scene = cc.director.getScene();
        const canvas = document.getElementById('GameCanvas');
        const rect = canvas.getBoundingClientRect();
        return {
          scene_name: scene && scene.name,
          root_children: scene ? scene.children.map(node => node.name) : [],
          frames: cc.director.getTotalFrames(),
          canvas_width: canvas.width, canvas_height: canvas.height,
          client_width: rect.width, client_height: rect.height,
          viewport_width: innerWidth, viewport_height: innerHeight,
          device_pixel_ratio: devicePixelRatio
        };
      });
    }
    const first = await runtimeState();
    report.initial_state = first;
    assert.equal(first.scene_name, 'Smoke');
    assert(first.root_children.includes('Canvas'));
    await pollUntil(() => page.evaluate(async before => (await System.import('cc')).director.getTotalFrames() >= before + 5, first.frames), { timeoutMs: 15000, label: 'advancing engine frames' });
    report.checks.push({ name: 'Real Smoke scene loaded with Canvas and advancing engine frames', status: 'PASS', state: await runtimeState() });
    for (const viewport of [{ width: 360, height: 800 }, { width: 720, height: 1280 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, viewport, { timeout: 10000 });
      // Observe multiple real animation frames after the resize, rather than treating DOM load as rendering.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await runtimeState();
      assert.equal(state.scene_name, 'Smoke');
      assert(state.canvas_width > 0 && state.canvas_height > 0);
      assert(Math.abs(state.client_width - viewport.width) <= 2);
      assert(Math.abs(state.client_height - viewport.height) <= 2);
      const screenshot = path.join(logs, 'smoke-' + viewport.width + 'x' + viewport.height + '.png');
      await page.screenshot({ path: screenshot });
      report.screenshots.push(screenshot);
      report.checks.push({ name: 'Viewport ' + viewport.width + 'x' + viewport.height, status: 'PASS', state });
    }
    assert.deepEqual(report.page_errors, []);
    assert.deepEqual(report.console_errors, []);
    assert.deepEqual(report.http_errors, []);
    assert.deepEqual(report.request_failures, []);
    assert.deepEqual(report.blocked_external_requests, []);
    report.checks.push({ name: 'No uncaught JS exceptions, console errors or failed/remote page requests', status: 'PASS' });
    report.status = 'BROWSER_SMOKE_PASSED';
  } catch (error) {
    report.status = 'BROWSER_SMOKE_FAILED';
    report.error = error.stack || error.message;
    if (page && !page.isClosed()) {
      const failureScreenshot = path.join(logs, 'failure.png');
      await page.screenshot({ path: failureScreenshot }).then(() => report.screenshots.push(failureScreenshot)).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(error => { report.browser_close_error = error.message; process.exitCode = 1; });
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    report.finished_at = new Date().toISOString();
    await fsp.writeFile(resultPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    console.log('BROWSER_REPORT=' + resultPath);
    console.log(JSON.stringify(report, null, 2));
  }
})();
