import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const repo = path.resolve(process.argv[2] ?? process.cwd());
const require = createRequire(`${repo}/package.json`);
const { build } = require("esbuild");
const ts = require("typescript");
const { chromium } = require("playwright");
// Execute the real method body without initializing unrelated panels/providers.
// Layout, observers, event handlers and rendering are never substituted.
const source = ts.createSourceFile(
  "panel-layout.ts",
  fs.readFileSync(`${repo}/src/app/panel-layout.ts`, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const klass = source.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === "PanelLayoutManager",
);
const method = klass.members
  .find((n) => n.name?.getText(source) === "renderCriticalBanner")
  .getText(source);
const stubs = {
  "@/services/breaking-news-alerts":
    "export const getAlertSettings=()=>({soundEnabled:false});",
  "@/services/i18n": "export const t=(key)=>key;",
  "@/services/sound-manager": "export const playAlertPing=()=>{};",
  "../services/datacenter/datacenter-state": `let site=null, posture=null, listeners=[]; export const getDatacenterSite=()=>site; export const getDatacenterPosture=()=>posture; export const subscribeDatacenterPosture=f=>{listeners.push(f);return()=>listeners=listeners.filter(x=>x!==f)}; export const set=(s,p)=>{site=s;posture=p;listeners.forEach(f=>f(p))};`,
};
const entry = `
import {notificationStack} from ${JSON.stringify(`${repo}/src/components/NotificationStack.ts`)};
import {BreakingNewsBanner} from ${JSON.stringify(`${repo}/src/components/BreakingNewsBanner.ts`)};
import {DataCenterPinnedStrip} from ${JSON.stringify(`${repo}/src/components/DataCenterPinnedStrip.ts`)};
import {set} from '../services/datacenter/datacenter-state';
import {escapeHtml} from ${JSON.stringify(`${repo}/src/utils/sanitize.ts`)};
const trackCriticalBannerAction=()=>{};
class Subject {ctx={isMobile:false,map:{setCenter:(...x)=>window.lastCenter=x}}; criticalBannerEl=null; ${method} }
notificationStack.mount();
const lower=document.createElement('div');lower.id='lower-row';lower.style.cssText='height:36px;min-height:36px;background:#445';lower.textContent='Existing alert row';notificationStack.element.append(lower);
window.subject=new Subject();window.breaking=new BreakingNewsBanner();
window.expand=0;window.dc=new DataCenterPinnedStrip(()=>window.expand++);document.querySelector('.cb-summary-strip').after(window.dc.getElement());
window.posture={postureLevel:'critical',strikeCapable:true,headline:'Critical posture',totalAircraft:4,summary:'Test region',theaterId:'test',centerLat:0,centerLon:0};
window.setDc=(level='warning',stale=false)=>set({id:'test'}, {site:{name:'Test data center'},overall:level,headline:'Readiness state '.repeat(20),actions:[],staleInputs:stale?['weather']:[]});
window.ready=true;
`;
const out = await build({
  stdin: { contents: entry, loader: "ts", resolveDir: repo },
  bundle: true,
  write: false,
  format: "iife",
  plugins: [
    {
      name: "boundaries",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) =>
          Object.hasOwn(stubs, a.path)
            ? { path: a.path, namespace: "stub" }
            : undefined,
        );
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
          contents: stubs[a.path],
          loader: "js",
        }));
      },
    },
  ],
});
const html = `<!doctype html><link rel="stylesheet" href="/main.css"><style>html,body{margin:0} .fixture-header{height:32px;flex-shrink:0}.fixture-map{height:350px;min-height:350px}.fixture-panels{height:1800px;min-height:1800px}</style><body class="is-desktop-macos"><div id="app"><div class="header fixture-header">Header</div><div class="main-content"><div class="fixture-map">Map</div><div class="cb-summary-strip">Summary</div><div class="fixture-panels">Panels</div></div></div><script src="/entry.js"></script>`;
const server = http
  .createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/entry.js"
        ? "application/javascript"
        : req.url === "/main.css"
          ? "text/css"
          : "text/html",
    );
    res.end(
      req.url === "/entry.js"
        ? out.outputFiles[0].text
        : req.url === "/main.css"
          ? fs.readFileSync(`${repo}/src/styles/main.css`)
          : html,
    );
  })
  .listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  let pass = 0,
    fail = 0;
  const test = async (name, fn) => {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 720 },
      reducedMotion: "reduce",
    });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.ready);
      await settle(page);
      await fn(page);
      assert.deepEqual(pageErrors, []);
      console.log("PASS", name);
      pass++;
    } catch (e) {
      console.log("FAIL", name, e.message);
      fail++;
    } finally {
      await page.close();
    }
  };
  const settle = (p) =>
    p.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const rect = async (p, s) =>
    p.locator(s).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        left: r.left,
        right: r.right,
      };
    });
  await test("summary remains adjacent to stack at deep scroll", async (p) => {
    await p.locator(".main-content").evaluate((e) => (e.scrollTop = 700));
    await settle(p);
    const s = await rect(p, ".cb-summary-strip"),
      n = await rect(p, "#cb-notification-stack");
    console.log("GEOMETRY", JSON.stringify({ summary: s, stack: n }));
    assert.ok(
      Math.abs(s.top - n.bottom) < 1,
      `summary top ${s.top} != stack bottom ${n.bottom}`,
    );
  });
  await test("posture occupies first measured row and removal reclaims space", async (p) => {
    const before = await rect(p, "#cb-notification-stack");
    await p.evaluate(() => subject.renderCriticalBanner([posture]));
    await settle(p);
    const b = await rect(p, ".critical-posture-banner"),
      n = await rect(p, "#cb-notification-stack"),
      lower = await rect(p, "#lower-row");
    assert.equal(
      await p
        .locator("#cb-notification-stack > :first-child")
        .getAttribute("class"),
      "critical-posture-banner severity-critical",
    );
    assert.ok(b.height > 0);
    assert.ok(Math.abs(n.height - before.height - b.height) < 1);
    assert.ok(lower.top >= b.bottom);
    assert.equal(
      await p
        .locator(".critical-posture-banner")
        .evaluate((e) => getComputedStyle(e).pointerEvents),
      "auto",
    );
    await p.locator(".banner-view").click();
    assert.deepEqual(await p.evaluate(() => lastCenter), [0, 0, 4]);
    await p.evaluate(() => subject.renderCriticalBanner([]));
    await settle(p);
    assert.equal(
      (await rect(p, "#cb-notification-stack")).height,
      before.height,
    );
  });
  await test("breaking alert sits immediately below posture and remaining stack", async (p) => {
    await p.evaluate(() => {
      subject.renderCriticalBanner([posture]);
      document.dispatchEvent(
        new CustomEvent("wm:breaking-news", {
          detail: {
            id: "test",
            threatLevel: "high",
            headline: "Test headline",
            source: "Test",
            timestamp: new Date(),
          },
        }),
      );
    });
    await settle(p);
    let n = await rect(p, "#cb-notification-stack"),
      b = await rect(p, ".breaking-news-container");
    assert.ok(
      Math.abs(n.bottom - b.top) < 1,
      `breaking top ${b.top} != stack bottom ${n.bottom}`,
    );
    await p.evaluate(() => subject.renderCriticalBanner([]));
    await settle(p);
    n = await rect(p, "#cb-notification-stack");
    b = await rect(p, ".breaking-news-container");
    assert.ok(
      Math.abs(n.bottom - b.top) < 1,
      `after removal breaking top ${b.top} != stack bottom ${n.bottom}`,
    );
  });
  await test("posture dismissal frees stack height", async (p) => {
    const before = await rect(p, "#cb-notification-stack");
    await p.evaluate(() => subject.renderCriticalBanner([posture]));
    await settle(p);
    await p.locator(".banner-dismiss").click();
    await settle(p);
    assert.equal(
      (await rect(p, "#cb-notification-stack")).height,
      before.height,
    );
    assert.equal(
      await p
        .locator("body")
        .evaluate((e) => e.classList.contains("has-critical-banner")),
      false,
    );
  });
  await test("data center is compact, truncates long text and opens", async (p) => {
    await p.evaluate(() => setDc());
    await settle(p);
    const result = await p.locator(".dc-strip").evaluate((e) => {
      const s = getComputedStyle(e),
        t = e.querySelector(".dc-strip-text"),
        ts = getComputedStyle(t),
        dot = e.querySelector(".dc-strip-dot"),
        ds = getComputedStyle(dot);
      return {
        height: e.getBoundingClientRect().height,
        display: s.display,
        textOverflow: ts.textOverflow,
        overflow: ts.overflow,
        scroll: t.scrollWidth,
        client: t.clientWidth,
        dotWidth: dot.getBoundingClientRect().width,
        animation: ds.animationName,
      };
    });
    assert.equal(result.display, "flex");
    assert.ok(result.height >= 28 && result.height < 40);
    assert.equal(result.textOverflow, "ellipsis");
    assert.equal(result.overflow, "hidden");
    assert.ok(result.scroll > result.client);
    assert.equal(result.dotWidth, 8);
    assert.equal(result.animation, "none");
    await p.locator(".dc-strip").click();
    assert.equal(await p.evaluate(() => expand), 1);
  });
  await test("data center normal, warning, degraded and reduced-motion transitions", async (p) => {
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await p.evaluate(() => setDc("warning", true));
    assert.equal(
      await p
        .locator(".dc-strip-dot")
        .evaluate((e) => getComputedStyle(e).animationName),
      "dc-strip-pulse",
    );
    assert.equal(
      await p
        .locator(".dc-strip-text")
        .evaluate((e) => getComputedStyle(e).fontStyle),
      "italic",
    );
    await p.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await p
        .locator(".dc-strip-dot")
        .evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    await p.evaluate(() => setDc("normal"));
    assert.equal(
      await p
        .locator(".dc-strip-dot")
        .evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    assert.equal(
      await p
        .locator(".dc-strip-text")
        .evaluate((e) => getComputedStyle(e).fontStyle),
      "normal",
    );
  });
  await test("posture text wrapping keeps following breaking alert attached", async (p) => {
    await p.evaluate(() => subject.renderCriticalBanner([posture]));
    await settle(p);
    await p.setViewportSize({ width: 500, height: 720 });
    await p.evaluate(() =>
      subject.renderCriticalBanner([
        { ...posture, headline: "Long regional posture ".repeat(15) },
      ]),
    );
    await settle(p);
    const n = await rect(p, "#cb-notification-stack"),
      b = await rect(p, ".breaking-news-container");
    assert.ok(
      Math.abs(n.bottom - b.top) < 1,
      `wrapped breaking top ${b.top} != stack bottom ${n.bottom}`,
    );
  });
  await test("mobile posture transition removes existing banner without leaving reserved height", async (p) => {
    const before = await rect(p, "#cb-notification-stack");
    await p.evaluate(() => subject.renderCriticalBanner([posture]));
    await settle(p);
    await p.evaluate(() => {
      subject.ctx.isMobile = true;
      subject.renderCriticalBanner([posture]);
    });
    await settle(p);
    assert.equal(await p.locator(".critical-posture-banner").count(), 0);
    assert.equal(
      (await rect(p, "#cb-notification-stack")).height,
      before.height,
    );
  });
  console.log(`RESULT ${pass} pass / ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
