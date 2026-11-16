import {
  expect,
  test,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

import { futureWeekdayDate } from './dates';

const API = 'http://localhost:8080';

const GUESTS = [
  { name: 'Ada Lovelace', email: 'ada.lovelace@example.com' },
  { name: 'Grace Hopper', email: 'grace.hopper@example.com' },
  { name: 'Katherine Johnson', email: 'katherine.johnson@example.com' },
  { name: 'Margaret Hamilton', email: 'margaret.hamilton@example.com' },
];

/**
 * Seeds the host table against the real backend. Slots already taken by an
 * earlier spec are skipped, so this stays independent of test ordering.
 */
async function createUpcomingBookings(api: APIRequestContext): Promise<void> {
  const settings = await (await api.get(`${API}/api/host-settings`)).json();
  const types = await (await api.get(`${API}/api/booking-types`)).json();
  const typeId = types[0].id;
  const day = futureWeekdayDate(settings.timezone);
  const slots: string[] = await (
    await api.get(`${API}/api/slots?date=${day}&bookingTypeId=${typeId}`)
  ).json();

  let created = 0;
  for (const start of slots) {
    if (created === GUESTS.length) break;
    const guest = GUESTS[created];
    const response = await api.post(`${API}/api/bookings`, {
      data: {
        start,
        bookingTypeId: typeId,
        guestName: guest.name,
        guestEmail: guest.email,
      },
    });
    if (response.status() === 201) {
      created += 1;
    }
  }

  if (created !== GUESTS.length) {
    throw new Error(`created ${created} of ${GUESTS.length} layout bookings`);
  }
}

/** Returns how many rendered lines the cell's text occupies. */
async function cellLineCount(page: Page, selector: string): Promise<number> {
  return page.evaluate((value) => {
    const element = document.querySelector(value);
    if (element === null) return 0;
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));
    return tops.size;
  }, selector);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page must not scroll horizontally').toBeLessThanOrEqual(0);
}

async function expectDesktopTableLayout(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('a viewport is required');

  await page.goto('/host');
  await expect(page.getByRole('heading', { name: 'Upcoming bookings' })).toBeVisible();
  const region = page.getByRole('region', { name: 'Upcoming bookings' });
  await expect(region).toBeVisible();

  await expectNoPageOverflow(page);

  const scroll = await region.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scroll.scrollWidth, 'the table must fit its container on desktop').toBeLessThanOrEqual(
    scroll.clientWidth + 1,
  );

  for (const name of ['Date', 'Time', 'Duration', 'Type', 'Name', 'Email', 'Status']) {
    await expect(page.getByRole('columnheader', { name })).toBeVisible();
  }
  await expect(page.getByRole('columnheader', { name: 'Action' })).toBeAttached();

  const row = page.locator('tbody tr').first();
  const cells = row.getByRole('cell');
  await expect(cells).toHaveCount(8);

  for (let index = 0; index < 8; index += 1) {
    const box = await cells.nth(index).boundingBox();
    expect(box, `cell ${index} has no box`).not.toBeNull();
    if (box !== null) {
      expect(box.x, `cell ${index} starts off-screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `cell ${index} ends off-screen`).toBeLessThanOrEqual(
        viewport.width + 1,
      );
    }
  }

  await expect(row.getByRole('button', { name: /Cancel .* booking/ })).toBeVisible();

  const heights = await page
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((element) => Math.round(element.getBoundingClientRect().height)),
    );
  expect(
    Math.max(...heights) - Math.min(...heights),
    'row heights must stay consistent',
  ).toBeLessThanOrEqual(2);

  for (const index of [0, 1, 2, 3, 6]) {
    expect(
      await cellLineCount(page, `tbody tr:first-child td:nth-child(${index + 1})`),
      `column ${index} must render on one line`,
    ).toBe(1);
  }
}

test.describe('host bookings layout', () => {
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext();
    await createUpcomingBookings(api);
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1920, height: 768 },
  ]) {
    test(`fits every column on desktop at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await expectDesktopTableLayout(page);
    });
  }

  test('keeps the scroll region keyboard-reachable and the Date column visible at 375px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/host');
    await expect(page.getByRole('heading', { name: 'Upcoming bookings' })).toBeVisible();
    const region = page.getByRole('region', { name: 'Upcoming bookings' });
    await expect(region).toBeVisible();

    await expectNoPageOverflow(page);

    await region.focus();
    await expect(region).toBeFocused();

    const scroll = await region.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(
      scroll.scrollWidth,
      'the table must be horizontally scrollable on a phone',
    ).toBeGreaterThan(scroll.clientWidth);

    const firstDate = page.locator('tbody tr').first().getByRole('cell').first();
    await expect(firstDate).toBeVisible();

    await region.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });

    const regionBox = await region.boundingBox();
    const dateBox = await firstDate.boundingBox();
    expect(regionBox).not.toBeNull();
    expect(dateBox).not.toBeNull();
    if (regionBox !== null && dateBox !== null) {
      expect(dateBox.x, 'the Date column stays pinned while scrolling').toBeGreaterThanOrEqual(
        regionBox.x - 1,
      );
      expect(dateBox.x, 'the Date column stays inside the scroll region').toBeLessThan(
        regionBox.x + regionBox.width,
      );
    }

    const cancel = page
      .locator('tbody tr')
      .last()
      .getByRole('button', { name: /Cancel .* booking/ });
    await expect(cancel).toBeVisible();
    const cancelBox = await cancel.boundingBox();
    expect(cancelBox).not.toBeNull();
    if (cancelBox !== null) {
      expect(cancelBox.x).toBeGreaterThanOrEqual(0);
      expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(375 + 1);
    }
  });
});
