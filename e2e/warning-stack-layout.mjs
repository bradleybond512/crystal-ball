import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const repo = path.resolve(process.argv[2] ?? process.cwd());
const require = createRequire(`${repo}/package.json`);
const { build } = require("esbuild");
const { chromium } = require("playwright");
// Real component, ResizeObserver and stylesheet graph; synthetic warning rows
// isolate shelf geometry from provider state. This is not native WebKit acceptance.
const out = await build({
  stdin: {
    contents: `
import { notificationStack as stack } from ${JSON.stringify(`${repo}/src/components/NotificationStack.ts`)};
stack.mount(); window.stack=stack; window.actions=[];
window.rows=(count)=>{stack.element.replaceChildren();for(let i=0;i<count;i++){
 const row=document.createElement('div');row.className='fixture-warning';
 const action=document.createElement('button');action.textContent='Warning '+i;action.dataset.index=i;
 action.onclick=()=>window.actions.push(i);row.append(action);stack.element.append(row);
}}; window.ready=true;`,
    loader: "ts",
    resolveDir: repo,
  },
  bundle: true,
  write: false,
  format: "iife",
});
const content =
  '<main class="main-content"><button id="content-action">Content action</button><div class="fixture-long">Scrollable content</div><button id="content-bottom">Bottom content</button></main>';
const html = (
  native,
  collapsed,
) => `<!doctype html><link rel="stylesheet" href="/styles/main.css"><style>
.fixture-warning{min-height:48px;flex-shrink:0;pointer-events:auto;display:flex;align-items:center;background:#555}
#content-action,#content-bottom{min-height:32px;flex-shrink:0;align-self:flex-start}.fixture-long{min-height:900px}
</style><body class="${native ? "is-desktop-macos has-staleness-banner" : ""} ${collapsed ? "sidebar-collapsed" : ""}"><div id="app">${native ? `<div class="mac-shell"><aside class="mac-sidebar"><div class="mac-sidebar-drag"></div><nav class="mac-sidebar-nav"><button id="nav-action">Navigation</button></nav></aside><div class="mac-content"><div class="mac-content-toolbar"><button id="toolbar-action">Navigation toggle</button></div>${content}</div></div>` : `<header class="header"><button id="nav-action">Navigation</button></header>${content}`}</div><script src="/entry.js"></script>`;
const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/entry.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(out.outputFiles[0].text);
    } else if (
      url.pathname.startsWith("/styles/") &&
      !url.pathname.includes("..")
    ) {
      res.setHeader("Content-Type", "text/css");
      const file = path.join(repo, "src", url.pathname);
      res.end(fs.existsSync(file) ? fs.readFileSync(file) : "");
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        html(url.searchParams.has("native"), url.searchParams.has("collapsed")),
      );
    }
  })
  .listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const settle = (p) =>
  p.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
      ),
  );
const geometry = (p) =>
  p.evaluate(() => {
    const stack = document.querySelector("#cb-notification-stack"),
      r = stack.getBoundingClientRect();
    return {
      top: r.top,
      left: r.left,
      height: r.height,
      cap: (innerHeight - r.top) * 0.4,
      published: parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--notification-stack-h",
        ),
      ),
      scroll: stack.scrollHeight,
      client: stack.clientHeight,
    };
  });
const check = async (p) => {
  await settle(p);
  const g = await geometry(p);
  assert.ok(g.height <= g.cap + 1, `shelf ${g.height} exceeds cap ${g.cap}`);
  assert.ok(
    Math.abs(g.published - g.height) <= 0.5,
    `reserved ${g.published} != rendered ${g.height}`,
  );
  return g;
};
const hit = async (p, selector) => {
  assert.equal(
    await p.locator(selector).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return (
        r.height > 0 &&
        r.top >= 0 &&
        r.bottom <= innerHeight &&
        e.contains(
          document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
        )
      );
    }),
    true,
    `${selector} must be reachable by hit-testing`,
  );
  await p.locator(selector).click();
};
let browser,
  pass = 0,
  fail = 0;
try {
  browser = await chromium.launch({ headless: true });
  for (const scenario of [
    { name: "web short", width: 640, height: 360 },
    { name: "web narrow", width: 360, height: 640 },
    { name: "native-style expanded", width: 640, height: 360, native: true },
    {
      name: "native-style wide expanded",
      width: 900,
      height: 360,
      native: true,
    },
    {
      name: "native-style collapsed",
      width: 640,
      height: 360,
      native: true,
      collapsed: true,
    },
  ]) {
    const p = await browser.newPage({
      viewport: { width: scenario.width, height: scenario.height },
      reducedMotion: "reduce",
    });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    try {
      await p.goto(
        `http://127.0.0.1:${server.address().port}/?${scenario.native ? "native&" : ""}${scenario.collapsed ? "collapsed" : ""}`,
      );
      await p.waitForFunction(() => window.ready);
      assert.equal((await check(p)).height, 0);
      await p.evaluate(() => rows(1));
      assert.equal((await check(p)).height, 48);
      await p.evaluate(() => rows(20));
      const full = await check(p);
      assert.ok(Math.abs(full.height - full.cap) < 1);
      assert.ok(full.scroll > full.client);
      assert.equal(
        full.left,
        scenario.native && !scenario.collapsed && scenario.width > 720
          ? 180
          : 0,
      );
      assert.deepEqual(
        await p
          .locator(".fixture-warning button")
          .evaluateAll((es) => es.map((e) => Number(e.dataset.index))),
        Array.from({ length: 20 }, (_, i) => i),
      );
      if (scenario.native) {
        assert.equal(
          await p
            .locator(".main-content")
            .evaluate((e) => parseFloat(getComputedStyle(e).paddingTop)),
          full.published,
        );
        if (!scenario.collapsed)
          assert.equal(
            await p
              .locator(".mac-sidebar-nav")
              .evaluate((e) => parseFloat(getComputedStyle(e).paddingTop)),
            full.published,
          );
      } else {
        const app = await p.locator("#app").boundingBox();
        assert.ok(Math.abs(app.y - full.top - full.published) < 1);
        assert.ok(Math.abs(app.height - (scenario.height - app.y)) < 1);
      }
      await hit(p, "#content-action");
      await hit(p, scenario.collapsed ? "#toolbar-action" : "#nav-action");
      // Keyboard tabbing must reveal the last action inside the scroll container.
      await p.locator(".fixture-warning button").first().focus();
      for (let i = 1; i < 20; i++) await p.keyboard.press("Tab");
      await p.keyboard.press("Enter");
      assert.deepEqual(await p.evaluate(() => actions), [19]);
      assert.ok(
        await p
          .locator("#cb-notification-stack")
          .evaluate((e) => e.scrollTop > 0),
      );
      await hit(p, ".fixture-warning:last-child button");
      await p
        .locator(".main-content")
        .evaluate((e) => (e.scrollTop = e.scrollHeight));
      await hit(p, "#content-bottom");
      await p.setViewportSize({ width: scenario.width, height: 480 });
      const resized = await check(p);
      assert.ok(Math.abs(resized.height - resized.cap) < 1);
      assert.notEqual(resized.height, full.height);
      await p.evaluate(() => rows(1));
      assert.equal((await check(p)).height, 48);
      await p.evaluate(() => rows(0));
      assert.equal((await check(p)).height, 0);
      await p.evaluate(() => {
        rows(20);
      });
      await check(p);
      await p.evaluate(() => stack.destroy());
      await settle(p);
      assert.equal(await p.locator("#cb-notification-stack").count(), 0);
      assert.equal(
        await p.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            "--notification-stack-h",
          ),
        ),
        "",
      );
      await p.setViewportSize({ width: scenario.width, height: 400 });
      await settle(p);
      assert.equal(
        await p.evaluate(() =>
          document.documentElement.style.getPropertyValue(
            "--notification-stack-h",
          ),
        ),
        "",
      );
      assert.deepEqual(errors, []);
      console.log("GEOMETRY", scenario.name, JSON.stringify({ full, resized }));
      console.log("PASS", scenario.name);
      pass++;
    } catch (e) {
      console.log("FAIL", scenario.name, e.message);
      fail++;
    } finally {
      await p.close();
    }
  }
  console.log(`RESULT ${pass} pass / ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
