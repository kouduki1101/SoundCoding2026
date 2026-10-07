import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  for (const name of [
    'architecture',
    'sequence',
    'data-flow',
    'sonification',
    'approval-sequence',
    'health-sequence',
  ]) {
    await page.setContent(await readFile(`docs/${name}.svg`, 'utf8'));
    await page.addStyleTag({ content: 'body { margin: 0; }' });
    await page.screenshot({ path: `artifacts/${name}.png` });
  }
} finally {
  await browser.close();
}
