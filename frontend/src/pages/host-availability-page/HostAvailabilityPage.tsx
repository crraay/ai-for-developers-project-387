import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router';

import {
  createRecurringWindowMutation,
  deleteRecurringWindowMutation,
  getHostSettingsOptions,
  listRecurringWindowsOptions,
  listRecurringWindowsQueryKey,
  updateRecurringWindowMutation,
} from '../../api/@tanstack/react-query.gen';
import type { RecurringWindowResponse } from '../../api/types.gen';
import { errorMessage } from '../../lib/api-errors';
import { useDocumentTitle } from '../../lib/use-document-title';
import styles from './host-availability-page.module.scss';

interface Day {
  code: string;
  label: string;
  short: string;
}

/** Monday-to-Sunday order; the API uses the same RFC 5545 codes. */
const DAYS: readonly Day[] = [
  { code: 'MO', label: 'Monday', short: 'Mon' },
  { code: 'TU', label: 'Tuesday', short: 'Tue' },
  { code: 'WE', label: 'Wednesday', short: 'Wed' },
  { code: 'TH', label: 'Thursday', short: 'Thu' },
  { code: 'FR', label: 'Friday', short: 'Fri' },
  { code: 'SA', label: 'Saturday', short: 'Sat' },
  { code: 'SU', label: 'Sunday', short: 'Sun' },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type EditState =
  { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; original: RecurringWindowResponse };

interface Draft {
  daysOfWeek: string[];
  startTime: string;
  endTime: string;
}

function blankDraft(): Draft {
  return { daysOfWeek: [], startTime: '09:00', endTime: '17:00' };
}

function draftFrom(window: RecurringWindowResponse): Draft {
  return {
    daysOfWeek: [...window.daysOfWeek],
    startTime: window.startTime,
    endTime: window.endTime,
  };
}

/** Returns the first validation error message, or null if the draft is OK. */
function validateDraft(draft: Draft): string | null {
  if (draft.daysOfWeek.length === 0) return 'Select at least one day.';
  if (!TIME_PATTERN.test(draft.startTime)) return 'Start time must be HH:mm.';
  if (!TIME_PATTERN.test(draft.endTime)) return 'End time must be HH:mm.';
  if (draft.endTime <= draft.startTime) {
    return 'End time must be after start time; a window cannot cross midnight.';
  }
  return null;
}

function sortDays(days: string[]): string[] {
  return DAYS.filter((day) => days.includes(day.code)).map((day) => day.code);
}

function formatRun(run: readonly Day[]): string {
  const first = run[0];
  const last = run[run.length - 1];
  if (first === undefined || last === undefined) return '';
  return first === last ? first.short : `${first.short}–${last.short}`;
}

/** "Mon–Fri", "Sat–Sun", "Mon, Wed, Fri". */
function formatDays(days: readonly string[]): string {
  const selected = DAYS.filter((day) => days.includes(day.code));
  const parts: string[] = [];
  let run: Day[] = [];
  for (const day of selected) {
    const previous = run[run.length - 1];
    if (previous !== undefined && DAYS.indexOf(day) !== DAYS.indexOf(previous) + 1) {
      parts.push(formatRun(run));
      run = [];
    }
    run.push(day);
  }
  if (run.length > 0) parts.push(formatRun(run));
  return parts.join(', ');
}

/** UC-1: the host manages the weekly recurring windows guests can book from. */
function HostAvailabilityPage() {
  useDocumentTitle('Host — Availability');

  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [edit, setEdit] = useState<EditState>({ mode: 'closed' });
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const settings = useQuery(getHostSettingsOptions());
  const windows = useQuery(listRecurringWindowsOptions());
  const zone = settings.data?.timezone ?? null;

  function closeEditor(): void {
    setEdit({ mode: 'closed' });
    setDraft(blankDraft());
    setFormError(null);
  }

  function onSaved(): void {
    closeEditor();
    void queryClient.invalidateQueries({ queryKey: listRecurringWindowsQueryKey() });
  }

  const create = useMutation({
    ...createRecurringWindowMutation(),
    onSuccess: onSaved,
    onError: (error) => setFormError(errorMessage(error, 'Saving the window failed.')),
  });

  const update = useMutation({
    ...updateRecurringWindowMutation(),
    onSuccess: onSaved,
    onError: (error) => setFormError(errorMessage(error, 'Saving the window failed.')),
  });

  const remove = useMutation({
    ...deleteRecurringWindowMutation(),
    onSuccess: () => {
      setConfirmingDeleteId(null);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: listRecurringWindowsQueryKey() });
    },
    onError: (error) => setDeleteError(errorMessage(error, 'Deleting the window failed.')),
  });

  const submitting = create.isPending || update.isPending;
  const editing = edit.mode !== 'closed';
  const list = windows.data ?? [];
  const loadError = windows.isError
    ? errorMessage(windows.error, 'Could not load availability windows.')
    : null;

  function beginCreate(): void {
    setEdit({ mode: 'create' });
    setDraft(blankDraft());
    setFormError(null);
  }

  function beginEdit(window: RecurringWindowResponse): void {
    setEdit({ mode: 'edit', original: window });
    setDraft(draftFrom(window));
    setFormError(null);
  }

  function toggleDay(code: string, checked: boolean): void {
    const next = checked
      ? sortDays([...draft.daysOfWeek, code])
      : draft.daysOfWeek.filter((day) => day !== code);
    setDraft({ ...draft, daysOfWeek: next });
  }

  function submit(): void {
    if (submitting || edit.mode === 'closed') {
      return;
    }
    const validation = validateDraft(draft);
    if (validation !== null) {
      setFormError(validation);
      return;
    }
    setFormError(null);
    const body = {
      daysOfWeek: draft.daysOfWeek,
      startTime: draft.startTime,
      endTime: draft.endTime,
    };
    if (edit.mode === 'create') {
      create.mutate({ body });
      return;
    }
    update.mutate({ path: { id: edit.original.id }, body });
  }

  function openDelete(window: RecurringWindowResponse): void {
    setConfirmingDeleteId(window.id);
    setDeleteError(null);
    remove.reset();
    // `<dialog>.showModal()` isn't implemented in jsdom, so guard the call.
    dialogRef.current?.showModal?.();
  }

  function closeDelete(): void {
    dialogRef.current?.close?.();
    setConfirmingDeleteId(null);
    setDeleteError(null);
    remove.reset();
  }

  return (
    <section className="page">
      <h2>Availability</h2>
      <p>
        <Link to="/host">Back to bookings</Link>
      </p>
      <p className={styles.hint}>
        Guests can book only inside these weekly windows
        {zone !== null ? ` (times shown in ${zone})` : ''}. Changes apply to the next slot browse;
        existing bookings are never cancelled.
      </p>

      {windows.isPending ? (
        <p className={styles.hint}>Loading…</p>
      ) : loadError !== null ? (
        <>
          <p className={styles.error} role="alert">
            {loadError}
          </p>
          <button type="button" onClick={() => void windows.refetch()}>
            Retry
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={`${styles.primary} ${styles.newWindow}`}
            disabled={editing}
            onClick={beginCreate}
          >
            New window
          </button>

          {list.length === 0 ? (
            <p className={styles.hint}>No availability windows yet — add your first one.</p>
          ) : (
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Availability windows"
              tabIndex={0}
            >
              <table className={styles.windows}>
                <thead>
                  <tr>
                    <th scope="col">Days</th>
                    <th scope="col">Time</th>
                    <th scope="col">
                      <span className={styles.visuallyHidden}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((window) => (
                    <tr key={window.id}>
                      <td>{formatDays(window.daysOfWeek)}</td>
                      <td className={styles.nowrap}>
                        {window.startTime}–{window.endTime}
                      </td>
                      <td className={styles.rowActions}>
                        <button type="button" disabled={editing} onClick={() => beginEdit(window)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.danger}
                          onClick={() => openDelete(window)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {editing && (
            <section className={styles.editor} aria-label="Availability window editor">
              <h3>
                {edit.mode === 'create' ? 'New availability window' : 'Edit availability window'}
              </h3>

              <fieldset className={styles.days}>
                <legend className={styles.fieldLabel}>Days</legend>
                <div className={styles.dayGrid}>
                  {DAYS.map((day) => (
                    <label key={day.code} className={styles.check}>
                      <input
                        type="checkbox"
                        name="daysOfWeek"
                        checked={draft.daysOfWeek.includes(day.code)}
                        onChange={(event) => toggleDay(day.code, event.target.checked)}
                      />
                      <span>{day.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className={styles.timeRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Start time</span>
                  <input
                    type="time"
                    name="startTime"
                    step={900}
                    value={draft.startTime}
                    onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>End time</span>
                  <input
                    type="time"
                    name="endTime"
                    step={900}
                    value={draft.endTime}
                    onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
                    required
                  />
                </label>
              </div>

              {zone !== null && <p className={styles.hint}>Times are in {zone}.</p>}

              {formError !== null && (
                <p className={styles.error} role="alert">
                  {formError}
                </p>
              )}

              <div className={styles.dialogActions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={submitting}
                  onClick={submit}
                >
                  {edit.mode === 'create' ? 'Create' : 'Save'}
                </button>
                <button type="button" disabled={submitting} onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </section>
          )}
        </>
      )}

      <dialog ref={dialogRef} className={styles.deleteDialog}>
        {confirmingDeleteId !== null && (
          <form
            method="dialog"
            className={styles.dialogBody}
            onSubmit={(event) => event.preventDefault()}
          >
            <h3>Delete this availability window?</h3>
            <p className={styles.hint}>
              New slots stop being offered in this window. Existing bookings are not cancelled.
            </p>
            {deleteError !== null && (
              <p className={styles.error} role="alert">
                {deleteError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.danger}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ path: { id: confirmingDeleteId } })}
              >
                Delete
              </button>
              <button type="button" disabled={remove.isPending} onClick={closeDelete}>
                Keep it
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}

export default HostAvailabilityPage;
