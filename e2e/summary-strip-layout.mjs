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
import {notificationStack, NotificationStack} from ${JSON.stringify(`${repo}/src/components/NotificationStack.ts`)};
import {BreakingNewsBanner} from ${JSON.stringify(`${repo}/src/components/BreakingNewsBanner.ts`)};
import {DataCenterPinnedStrip} from ${JSON.stringify(`${repo}/src/components/DataCenterPinnedStrip.ts`)};
import {set} from '../services/datacenter/datacenter-state';
import {CriticalPostureBanner} from ${JSON.stringify(`${repo}/src/components/CriticalPostureBanner.ts`)};
const trackCriticalBannerAction=()=>{};
class Subject {ctx={isMobile:false,map:{setCenter:(...x)=>window.lastCenter=x}}; criticalPostureBanner=new CriticalPostureBanner(notificationStack.element,(lat,lon)=>this.ctx.map.setCenter(lat,lon,4),trackCriticalBannerAction); ${method} }
if (!new URLSearchParams(location.search).has('late')) notificationStack.mount();
window.stack=notificationStack;window.Stack=NotificationStack;window.Banner=BreakingNewsBanner;
const lower=document.createElement('div');lower.id='lower-row';lower.style.cssText='height:36px;min-height:36px;background:#445';lower.textContent='Existing alert row';notificationStack.element.append(lower);
window.subject=new Subject();window.breaking=new BreakingNewsBanner();
window.expand=0;window.dc=new DataCenterPinnedStrip(()=>window.expand++);document.querySelector('.cb-summary-strip').after(window.dc.getElement());
window.posture={postureLevel:'critical',strikeCapable:true,headline:'Critical posture',totalAircraft:4,summary:'Test region',theaterId:'test',theaterName:'Test region',centerLat:0,centerLon:0};
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
// Native CSS hides the web header. Include the actual 44px toolbar so the
// scroll fixture has the same vertical origin as the native shell.
const html = `<!doctype html><link rel="stylesheet" href="/main.css"><style>html,body{margin:0} .fixture-header{height:32px;flex-shrink:0}.fixture-map{height:350px;min-height:350px}.fixture-panels{height:1800px;min-height:1800px}</style><body class="is-desktop-macos"><div id="app"><div class="header fixture-header">Header</div><div class="mac-content-toolbar">Native toolbar</div><div class="main-content"><div class="fixture-map">Map</div><div class="cb-summary-strip">Summary</div><div class="fixture-panels">Panels</div></div></div><script src="/entry.js"></script>`;
const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/entry.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(out.outputFiles[0].text);
    } else if (url.pathname.endsWith('.css')) {
      const file = path.resolve(repo, 'src/styles', `.${url.pathname}`);
      if (!file.startsWith(path.resolve(repo, 'src/styles') + path.sep) || !fs.existsSync(file)) {
        res.writeHead(404); res.end(); return;
      }
      res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(file));
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(url.searchParams.has('web') ? html.replace('class="is-desktop-macos"', '').replace('<div class="mac-content-toolbar">Native toolbar</div>', '') : html);
    }
  })
  .listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  let pass = 0,
    fail = 0;
  const test = async (name, fn, options = {}) => {
    const page = await browser.newPage({
      viewport: { width: options.width ?? 1000, height: 720 },
      reducedMotion: "reduce",
    });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    try {
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      const query = new URLSearchParams();
      if (options.web) query.set('web', '1');
      if (options.late) query.set('late', '1');
      await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
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
  await test("posture status is visually clipped and exposed as polite in the accessibility tree", async (p) => {
    const live = p.locator("[data-posture-announcer]");
    assert.equal(await live.count(), 1, "the live region is mounted before the first posture update");
    assert.equal(await live.textContent(), "");
    const style = await live.evaluate((node) => {
      const css = getComputedStyle(node);
      return [css.position, css.width, css.height, css.overflow, css.clip];
    });
    assert.deepEqual(style, ["absolute", "1px", "1px", "hidden", "rect(0px, 0px, 0px, 0px)"]);
    const cdp = await p.context().newCDPSession(p);
    try {
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      assert.ok(nodes.some((node) => !node.ignored && node.role?.value === "status"
        && node.properties?.some((prop) => prop.name === "live" && prop.value.value === "polite")
        && node.properties?.some((prop) => prop.name === "atomic" && prop.value.value === true)),
      "the browser exposes an atomic polite status");
    } finally { await cdp.detach(); }
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
  const activate = async (p) => {
    await p.evaluate(() => document.dispatchEvent(new CustomEvent('wm:breaking-news', {detail: {
      id: 'ordinary', threatLevel: 'high', headline: 'Synthetic warning', source: 'Fixture', timestamp: new Date(),
    }})));
    await settle(p);
  };
  const attached = async (p) => {
    await p.waitForFunction(() => {
      const s = document.getElementById('cb-notification-stack');
      const b = document.querySelector('.breaking-news-container');
      return s && b && Math.abs(s.getBoundingClientRect().bottom - b.getBoundingClientRect().top) < 1
        && parseFloat(document.documentElement.style.getPropertyValue('--notification-stack-h')) === s.offsetHeight;
    }, null, {timeout: 1000});
    const s = await rect(p, '#cb-notification-stack'), b = await rect(p, '.breaking-news-container');
    assert.ok(Math.abs(s.bottom-b.top) < 1, JSON.stringify({s,b}));
    assert.ok(b.top >= s.bottom - 0.5, 'breaking must not overlap the shelf');
  };
  const trackIncidentalEvents = async (p) => p.evaluate(() => {
    window.incidental = {classes: 0, resize: 0};
    new MutationObserver(rs => incidental.classes += rs.length).observe(document.body, {attributes:true,attributeFilter:['class']});
    window.addEventListener('resize', () => incidental.resize++);
  });
  for (const web of [false, true]) {
    const variant = web ? 'web' : 'native-style';
    for (const [transition, height] of [['grow',140],['shrink',12],['remove',0]]) {
      await test(`${variant} ordinary row ${transition} follows shelf without incidental triggers`, async p => {
        // Start each independently counted transition at its actual prior size.
        if (transition !== 'grow') await p.evaluate(height => {
          const row = document.getElementById('lower-row');
          row.style.height = `${height}px`; row.style.minHeight = `${height}px`;
        }, transition === 'shrink' ? 140 : 12);
        await activate(p); await attached(p); await trackIncidentalEvents(p);
        await p.evaluate(height => {
          const row = document.getElementById('lower-row');
          if (height === 0) row.remove(); else {row.style.height = `${height}px`;row.style.minHeight = `${height}px`;}
        }, height);
        await attached(p);
        assert.deepEqual(await p.evaluate(() => incidental), {classes:0,resize:0});
        assert.equal(await p.locator('.critical-posture-banner').count(),0);
        assert.equal(await p.locator('.breaking-alert').count(),1);
      }, {web});
    }
    await test(`${variant} narrow ordinary text wrapping follows measured shelf`, async p => {
      await activate(p);await attached(p);await trackIncidentalEvents(p);
      const before = await rect(p,'#cb-notification-stack');
      await p.evaluate(() => {const row=document.getElementById('lower-row');row.style.height='auto';row.style.minHeight='0';row.textContent='Ordinary shelf text wrapping across narrow space. '.repeat(12);});
      await attached(p);
      assert.ok((await rect(p,'#cb-notification-stack')).height > before.height);
      assert.deepEqual(await p.evaluate(() => incidental),{classes:0,resize:0});
    },{web,width:500});
    await test(`${variant} late shelf mount follows active breaking without class or resize`, async p => {
      await activate(p);assert.equal((await rect(p,'.breaking-news-container')).top,44);
      await trackIncidentalEvents(p);await p.evaluate(() => stack.mount());await attached(p);
      assert.deepEqual(await p.evaluate(() => incidental),{classes:0,resize:0});
    },{web,late:true});
    await test(`${variant} replacement removal and reattachment track only the current shelf`, async p => {
      await activate(p);await attached(p);await trackIncidentalEvents(p);
      await p.evaluate(() => {window.oldStack=stack;oldStack.destroy();window.stack=new Stack();stack.element.innerHTML='<div style="height:90px;min-height:90px">Replacement</div>';stack.mount();});
      await attached(p);
      await p.evaluate(() => {oldStack.element.style.height='300px';});await settle(p);await attached(p);
      await p.evaluate(() => stack.destroy());
      await p.waitForFunction(() => document.querySelector('.breaking-news-container').getBoundingClientRect().top===44,null,{timeout:1000});
      await p.evaluate(() => stack.mount());await attached(p);
      await p.evaluate(() => {stack.element.remove();document.body.append(stack.element);});await attached(p);
      assert.deepEqual(await p.evaluate(() => incidental),{classes:0,resize:0});
    },{web});
    await test(`${variant} destroy prevents shelf changes from resurrecting breaking offset`, async p => {
      await activate(p);await attached(p);await p.evaluate(() => {breaking.destroy();stack.element.style.height='150px';stack.element.remove();document.body.append(stack.element);});
      await settle(p);
      assert.equal(await p.locator('.breaking-news-container').count(),0);
      assert.equal(await p.evaluate(() => document.documentElement.style.getPropertyValue('--breaking-alert-offset')),'');
      assert.equal(await p.evaluate(() => document.body.classList.contains('has-breaking-alert')),false);
    },{web});
  }
  console.log(`RESULT ${pass} pass / ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
