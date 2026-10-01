// Actual landing components, exact source baseline; no altered screenshots.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('.');
const out = join(root, 'harness/out/ux-landing');
const base = '6c388092b004e12f9a38b4f5958b1a1d46d8a9b4';
mkdirSync(out, { recursive: true });
const before = join(out, 'baseline');
execFileSync('git', ['worktree', 'add', '--detach', before, base], { stdio: 'inherit' });
symlinkSync(join(root, 'site/node_modules'), join(before, 'site/node_modules'), 'dir');
const { createServer } = await import(pathToFileURL(join(root, 'site/node_modules/vite/dist/node/index.js')));
const servers = [];
const browser = await chromium.launch();
try {
  for (const [label, path, port] of [['before', before, 4535], ['after', root, 4536]]) {
    const server = await createServer({ root: join(path, 'site'), configFile: join(path, 'site/vite.config.js'), server: { host: '127.0.0.1', port, strictPort: true } });
    await server.listen(); servers.push(server);
    for (const [device, viewport] of [['desktop', {width:1440,height:1000}], ['mobile', {width:390,height:844}]]) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      await page.goto(`http://127.0.0.1:${port}`);
      await page.getByRole('heading', {level:1}).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const headline = await page.getByRole('heading',{level:1}).innerText();
      assert.match(headline, label === 'before' ? /on autopilot/ : /You approve/);
      if (label === 'after') {
        assert.match(await page.locator('body').innerText(), /You approve each submission/);
        assert.match(await page.locator('body').innerText(), /application sites receive the details you enter/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
      }
      await page.screenshot({ path:join(out,`${label}-hero-${device}.png`), fullPage:false });
      if (device === 'desktop') {
        const track=page.getByText(label === 'before' ? 'needsFallback — the agent gave up; a human has to take this one' : 'Needs your help — open the application and check its history', {exact:true});
        await track.scrollIntoViewIfNeeded();
        await page.screenshot({path:join(out,`${label}-tracking.png`)});
      }
      await page.close();
    }
  }
  writeFileSync(join(out,'manifest.json'),JSON.stringify({baseline:base,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:'Real CoForce landing source; synthetic sample screenshots already shipped by the project; desktop and mobile Chromium captures'},null,2));
  console.log('PASS: baseline/after hero and tracking; desktop/mobile approval + data-flow disclosure; no horizontal overflow');
} finally { await browser.close(); for(const s of servers) await s.close(); }
