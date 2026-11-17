import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render';
import { server } from '../../test/server';
import HostAvailabilityPage from './HostAvailabilityPage';

const API = 'http://localhost:8080';
const TIMEZONE = 'Europe/Berlin';

interface Window {
  id: number;
  daysOfWeek: string[];
  startTime: string;
  endTime: string;
}

function asWindow(overrides: Partial<Window> = {}): Window {
  return {
    id: 1,
    daysOfWeek: ['MO', 'TU', 'WE', 'TH', 'FR'],
    startTime: '09:00',
    endTime: '17:00',
    ...overrides,
  };
}

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

/**
 * A stateful stand-in for the host availability API: writes change the list the
 * next GET returns, so the page's post-save refetch is exercised for real.
 */
function serve(
  initial: Window[] | { status: number; detail: string },
  createResponse?: { status: number; detail: string },
) {
  let list = Array.isArray(initial) ? [...initial] : [];
  const requests: RecordedRequest[] = [];

  server.use(
    http.get(`${API}/api/host-settings`, () => HttpResponse.json({ timezone: TIMEZONE })),
    http.get(`${API}/api/host/recurring-windows`, () => {
      if (Array.isArray(initial)) {
        return HttpResponse.json(list);
      }
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Server error',
          status: initial.status,
          detail: initial.detail,
        },
        { status: initial.status },
      );
    }),
    http.post(`${API}/api/host/recurring-windows`, async ({ request }) => {
      const body = (await request.json()) as Omit<Window, 'id'>;
      requests.push({ method: 'POST', url: request.url, body });
      if (createResponse !== undefined) {
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Invalid request',
            status: createResponse.status,
            detail: createResponse.detail,
          },
          { status: createResponse.status },
        );
      }
      const created = { ...body, id: 99 };
      list = [...list, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.put(`${API}/api/host/recurring-windows/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Omit<Window, 'id'>;
      requests.push({ method: 'PUT', url: request.url, body });
      const updated = { id: Number(params.id), ...body };
      list = list.map((window) => (window.id === updated.id ? updated : window));
      return HttpResponse.json(updated);
    }),
    http.delete(`${API}/api/host/recurring-windows/:id`, ({ request, params }) => {
      requests.push({ method: 'DELETE', url: request.url, body: null });
      list = list.filter((window) => window.id !== Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return { requests };
}

describe('HostAvailabilityPage', () => {
  it('lists the loaded windows with readable days, times and timezone', async () => {
    serve([
      asWindow({ id: 1 }),
      asWindow({ id: 2, daysOfWeek: ['SA', 'SU'], startTime: '10:00', endTime: '12:00' }),
    ]);
    renderWithProviders(<HostAvailabilityPage />);

    expect(await screen.findByText('Mon–Fri')).toBeInTheDocument();
    expect(screen.getByText('09:00–17:00')).toBeInTheDocument();
    expect(screen.getByText('Sat–Sun')).toBeInTheDocument();
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(TIMEZONE))).toBeInTheDocument();
  });

  it('shows the empty state when there are no windows', async () => {
    serve([]);
    renderWithProviders(<HostAvailabilityPage />);

    expect(await screen.findByText(/No availability windows yet/)).toBeInTheDocument();
  });

  it('shows the loading state until the windows arrive', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/api/host-settings`, () => HttpResponse.json({ timezone: TIMEZONE })),
      http.get(`${API}/api/host/recurring-windows`, async () => {
        await gate;
        return HttpResponse.json([asWindow({ id: 1 })]);
      }),
    );
    renderWithProviders(<HostAvailabilityPage />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    release?.();

    expect(await screen.findByText('Mon–Fri')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('POSTs the new window with the chosen days and times', async () => {
    const user = userEvent.setup();
    const { requests } = serve([asWindow({ id: 1 })]);
    renderWithProviders(<HostAvailabilityPage />);
    await screen.findByText('Mon–Fri');

    await user.click(screen.getByRole('button', { name: 'New window' }));
    await user.click(screen.getByLabelText('Saturday'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '11:00' } });
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      method: 'POST',
      body: { daysOfWeek: ['SA'], startTime: '10:00', endTime: '11:00' },
    });
    expect(await screen.findByText('Sat')).toBeInTheDocument();
  });

  it('PUTs the edited window and refreshes the list', async () => {
    const user = userEvent.setup();
    const { requests } = serve([asWindow({ id: 1 })]);
    renderWithProviders(<HostAvailabilityPage />);
    await screen.findByText('Mon–Fri');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '18:00' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      method: 'PUT',
      body: { daysOfWeek: ['MO', 'TU', 'WE', 'TH', 'FR'], startTime: '09:00', endTime: '18:00' },
    });
    expect(requests[0]?.url).toContain('/api/host/recurring-windows/1');
    expect(await screen.findByText('09:00–18:00')).toBeInTheDocument();
  });

  it('deletes only after confirming in the dialog', async () => {
    const user = userEvent.setup();
    const { requests } = serve([asWindow({ id: 1 })]);
    renderWithProviders(<HostAvailabilityPage />);
    await screen.findByText('Mon–Fri');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this availability window?')).toBeInTheDocument();
    expect(screen.getByText(/Existing bookings are not cancelled/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);

    const dialog = screen.getByText('Delete this availability window?').closest('dialog');
    expect(dialog).not.toBeNull();
    // jsdom does not open the dialog, so its content stays outside the
    // accessibility tree and user-event's pointer checks refuse the click.
    fireEvent.click(
      within(dialog as HTMLElement).getByRole('button', { name: 'Delete', hidden: true }),
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ method: 'DELETE' });
    expect(await screen.findByText(/No availability windows yet/)).toBeInTheDocument();
  });

  it('blocks no-days and midnight-crossing input without a request', async () => {
    const user = userEvent.setup();
    const { requests } = serve([asWindow({ id: 1 })]);
    renderWithProviders(<HostAvailabilityPage />);
    await screen.findByText('Mon–Fri');

    await user.click(screen.getByRole('button', { name: 'New window' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Select at least one day.')).toBeInTheDocument();
    expect(requests).toHaveLength(0);

    await user.click(screen.getByLabelText('Monday'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '09:00' } });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      screen.getByText('End time must be after start time; a window cannot cross midnight.'),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('surfaces a server validation error in the editor', async () => {
    const user = userEvent.setup();
    serve([asWindow({ id: 1 })], { status: 400, detail: 'endTime is invalid' });
    renderWithProviders(<HostAvailabilityPage />);
    await screen.findByText('Mon–Fri');

    await user.click(screen.getByRole('button', { name: 'New window' }));
    await user.click(screen.getByLabelText('Saturday'));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('endTime is invalid')).toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    const user = userEvent.setup();
    let failing = true;
    server.use(
      http.get(`${API}/api/host-settings`, () => HttpResponse.json({ timezone: TIMEZONE })),
      http.get(`${API}/api/host/recurring-windows`, () => {
        if (failing) {
          return HttpResponse.json(
            { type: 'about:blank', title: 'Server error', status: 500, detail: 'boom' },
            { status: 500 },
          );
        }
        return HttpResponse.json([asWindow({ id: 1 })]);
      }),
    );
    renderWithProviders(<HostAvailabilityPage />);

    expect(await screen.findByText('boom')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Mon–Fri')).toBeInTheDocument();
  });
});
