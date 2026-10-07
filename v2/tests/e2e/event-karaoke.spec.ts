import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('a sung source line opens its grounded code without writing to the repository', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('code-groove-hide-guide', 'true'));
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/')) writes++;
  });
  await page.goto('/projects/sample-recorded-tsugiai-agents/inspect?scene=1');

  const rows = page.locator('.event-karaoke-slot[data-event-id]');
  await expect(rows).toHaveCount(5);
  const eventId = await rows.first().getAttribute('data-event-id');
  const fixture = JSON.parse(readFileSync('fixtures/recorded-live/tsugiai-agents.json', 'utf8'));
  const event = fixture.map.events.find((item: { event_id: string }) => item.event_id === eventId);
  expect(event).toBeTruthy();
  const row = page.locator(`.event-karaoke-slot[data-event-id="${eventId}"]`);
  const line = Number((await row.locator('.event-karaoke-location').innerText()).split(':').at(-1));
  const sourceLine = fixture.sources[event.span.path].split(/\r\n?|\n/)[line - 1].trimStart();
  await expect(row.locator('.event-karaoke-source code').first()).toHaveText(sourceLine);

  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('code-location')).toContainText(
    `${event.span.path}:${event.span.start_line}–${event.span.end_line}`,
  );
  expect(writes).toBe(0);

  await page.setViewportSize({ width: 980, height: 600 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const current = page.locator('.event-karaoke-slot.current');
  await expect(current).toBeVisible();
  await expect(current).toHaveAttribute('aria-current', 'true');
});

test('repeated notes on one source line keep individual navigation without repeating the code text', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('code-groove-hide-guide', 'true'));
  const fixture = JSON.parse(readFileSync('fixtures/recorded-live/tsugiai-agents.json', 'utf8'));
  const notes = fixture.score.scenes[0].repo.notes;
  const original = notes.find((note: { kind: string }) => note.kind === 'data');
  notes.push({ ...original, note_id: 'repeat_event_source_line', tick: original.tick + 80 });
  await page.route('**/api/v1/samples/recorded-tsugiai-agents/bundle', (route) =>
    route.fulfill({ json: { data: fixture } }),
  );
  await page.goto(`/projects/sample-recorded-tsugiai-agents/inspect?scene=1&event=${original.event_id}`);
  const repeated = page.locator('.event-karaoke-repeat');
  await expect(repeated).toBeVisible();
  await expect(repeated).toContainText('同じコード行');
  const repeatedRow = page.locator('.event-karaoke-slot[data-note-id$="repeat_event_source_line"]');
  await repeatedRow.click();
  await expect(repeatedRow).toHaveAttribute('aria-pressed', 'true');
});
