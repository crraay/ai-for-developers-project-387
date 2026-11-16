import { expect, test } from '@playwright/test';

import { formatDateInTimeZone, futureSaturdayDate } from './dates';

const API = 'http://localhost:8080';

/** Host-local HH:mm for an instant, in the same wall-clock terms the API uses. */
const hostTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

test('deleting a window never cancels a booking and stops new slots', async ({ page }) => {
  test.setTimeout(90_000);

  const settingsResponse = await page.request.get(`${API}/api/host-settings`);
  expect(settingsResponse.ok()).toBeTruthy();
  const { timezone: hostTimeZone } = await settingsResponse.json();

  const types = await (await page.request.get(`${API}/api/booking-types`)).json();
  const typeId = types[0].id;
  const saturday = futureSaturdayDate(hostTimeZone);
  const guestEmail = 'availability-e2e@example.com';

  // The seed has no Saturday availability.
  const before = await page.request.get(
    `${API}/api/slots?date=${saturday}&bookingTypeId=${typeId}`,
  );
  expect(before.ok()).toBeTruthy();
  expect(await before.json()).toEqual([]);

  // Create a Saturday 10:00-11:00 window through the host UI.
  await page.goto('/host/availability');
  await expect(page.getByRole('heading', { name: 'Availability' })).toBeVisible();
  await page.getByRole('button', { name: 'New window' }).click();
  await page.getByLabel('Saturday').check();
  await page.getByLabel('Start time').fill('10:00');
  await page.getByLabel('End time').fill('11:00');
  await page.getByRole('button', { name: 'Create' }).click();

  const saturdayRow = page.getByRole('row', { name: /Sat/ });
  await expect(saturdayRow).toContainText('10:00–11:00');

  // Guest slots now fall only inside the new window, on the 15-minute grid.
  const opened = await page.request.get(`${API}/api/slots?date=${saturday}&bookingTypeId=${typeId}`);
  expect(opened.ok()).toBeTruthy();
  const starts: string[] = await opened.json();
  expect(starts.length).toBeGreaterThan(0);
  for (const start of starts) {
    expect(formatDateInTimeZone(new Date(start), hostTimeZone)).toBe(saturday);
    const time = hostTime(start, hostTimeZone);
    expect(time >= '10:00' && time < '11:00').toBeTruthy();
    expect((Date.parse(start) / 60_000) % 15).toBe(0);
  }
  expect(hostTime(starts[0], hostTimeZone)).toBe('10:00');
  expect(hostTime(starts[starts.length - 1], hostTimeZone)).toBe('10:30');

  // Book the first offered start against the real API.
  const bookingResponse = await page.request.post(`${API}/api/bookings`, {
    data: {
      start: starts[0],
      bookingTypeId: typeId,
      guestName: 'Availability Guest',
      guestEmail,
    },
  });
  expect(bookingResponse.status()).toBe(201);
  expect((await bookingResponse.json()).state).toBe('active');

  // Delete the window through the host UI, confirming in the dialog.
  await saturdayRow.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toContainText('Delete this availability window?');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('row', { name: /Sat/ })).toHaveCount(0);
  await expect(dialog).toBeHidden();

  // No new slots appear in the deleted window...
  const closed = await page.request.get(`${API}/api/slots?date=${saturday}&bookingTypeId=${typeId}`);
  expect(closed.ok()).toBeTruthy();
  expect(await closed.json()).toEqual([]);

  // ...but the booking survives, still active and visible to the host.
  const bookings = await (await page.request.get(`${API}/api/bookings`)).json();
  const surviving = bookings.find(
    (booking: { guestEmail: string }) => booking.guestEmail === guestEmail,
  );
  expect(surviving).toBeDefined();
  expect(surviving.state).toBe('active');

  await page.goto('/host');
  await expect(page.getByRole('heading', { name: 'Upcoming bookings' })).toBeVisible();
  const bookingRow = page.getByRole('row', { name: new RegExp(guestEmail) });
  await expect(bookingRow).toContainText('Confirmed');
});
