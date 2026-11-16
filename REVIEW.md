# Review criteria: call calendar

This file is the project-specific half of the review contract. Read it together
with `docs/agents/review.md`; the generic evidence bar and the Standards/Spec
axes live there. A finding that violates one of these invariants is a defect
even when the change is small.

## Booking and slot invariants

- **An active booking blocks its slot.** A booked slot must not be returned as
  available again by the slot picker or accepted by the booking endpoint.
- **Partial overlaps are conflicts.** Two bookings conflict when their time
  ranges intersect, not only when they share the same start. Adjacent ranges
  (one ends exactly when the next starts) are allowed.
- **Cancellation frees the slot.** A cancelled booking must stop blocking new
  bookings for that range.
- **State is visible consistently.** A cancelled booking must not be promoted
  as "Happening now" or appear active in the host or guest views. The host view
  and the API must agree on `active` versus `cancelled`.
- **The booking window is consistent.** The 14-calendar-day horizon, the
  guest's timezone and the host's timezone must resolve the same day; a DST
  boundary must not create or hide a slot.
- **Booking types are not deleted out from under bookings.** Deleting a type
  that existing bookings reference must not corrupt or hide those bookings; new
  bookings must stop offering it.

## Host and guest surfaces

- **Host layouts preserve the table contract.** At desktop widths the host
  bookings table must fit without page-level horizontal scrolling, keep Date,
  Time, Duration and Cancel readable, and keep semantic headers. At narrow
  widths the labelled, keyboard-focusable scroll region and the sticky Date
  column must survive.
- **Dialogs reflect the server result.** A delete/cancel dialog must not close
  on a failed request, and the page must show the error instead of a false
  success.
- **Accessibility is part of the behaviour.** A change that drops table
  semantics, the accessible Cancel label, `aria-pressed` filter state or the
  ongoing-booking status role is a defect, not a styling preference.

## Contract and generated code

- `typespec/main.tsp` is the contract source. `openapi/api.yml` and
  `frontend/src/api/` are generated; a hand edit to either is a finding.
- A route or response-shape change needs the regenerated output in the same
  change and a test at the seam that consumes it.

## How to report

Follow the evidence bar in `docs/agents/review.md`: file and line, conditions
that make it fail, impact, and the smallest change that would resolve it. For a
calendar defect, name the concrete scenario (for example "30-minute booking at
10:00 blocks 10:30; the next slot query still returns 10:00"). Do not report
formatting, naming preferences or "consider" suggestions; the linters and
`mise run check` cover those.

End with `**Verdict:** no confirmed defects` when the change preserves these
invariants, or list the findings and the worst one. If the linked spec or human
approval is unavailable, say that explicitly; an unexamined invariant is not a
clean review.
