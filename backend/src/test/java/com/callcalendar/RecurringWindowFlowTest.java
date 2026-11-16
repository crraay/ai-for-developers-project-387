package com.callcalendar;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.callcalendar.api.BookingResponse;
import com.callcalendar.api.CreateBookingRequest;
import com.callcalendar.api.HostBookingResponse;
import com.callcalendar.api.RecurringWindowRequest;
import com.callcalendar.api.RecurringWindowResponse;
import io.micronaut.core.type.GenericArgument;
import io.micronaut.http.HttpMethod;
import io.micronaut.http.HttpRequest;
import io.micronaut.http.client.HttpClient;
import io.micronaut.http.client.annotation.Client;
import io.micronaut.http.client.exceptions.HttpClientResponseException;
import io.micronaut.test.extensions.junit5.annotation.MicronautTest;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.Statement;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Host recurring-window CRUD against real Postgres, plus the promise that writes change the very
 * next guest slot browse and never touch an existing booking. Only rows created here are cleaned
 * up; the seeded Mon-Fri window stays in place for the rest of the suite.
 */
@MicronautTest
class RecurringWindowFlowTest {

  private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");

  /** Seeded Quick chat (30 min): fits at 10:00 and 10:30 inside a 10:00-11:00 window. */
  private static final long QUICK_CHAT_ID = 1L;

  @Inject
  @Client("/")
  HttpClient client;

  @Inject DataSource dataSource;

  @BeforeEach
  void clearBookingsAndCreatedWindows() throws Exception {
    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement()) {
      statement.executeUpdate("DELETE FROM booking");
      statement.executeUpdate("DELETE FROM recurring_window WHERE id > 1");
    }
  }

  @Test
  void seededWindowIsListedWithItsDaysAndTimes() {
    List<RecurringWindowResponse> windows = list();
    assertEquals(1, windows.size());
    RecurringWindowResponse seeded = windows.get(0);
    assertEquals(List.of("MO", "TU", "WE", "TH", "FR"), seeded.daysOfWeek());
    assertEquals("09:00", seeded.startTime());
    assertEquals("17:00", seeded.endTime());
  }

  @Test
  void createdWindowAppearsInTheListAndWidensSlotsImmediately() {
    LocalDate saturday = nextSaturday();
    assertTrue(slots(saturday, QUICK_CHAT_ID).isEmpty());

    RecurringWindowResponse created = create(List.of("SA"), "10:00", "11:00");
    assertTrue(created.id() > 1);
    assertEquals(List.of("SA"), created.daysOfWeek());
    assertEquals("10:00", created.startTime());
    assertEquals("11:00", created.endTime());

    assertTrue(list().stream().anyMatch(window -> window.id() == created.id()));

    // The seed has no Saturday availability, so the new window alone produces these starts:
    // a 30-minute slot fits at 10:00, 10:15 and 10:30 but not 10:45.
    assertEquals(
        List.of(
            saturday.atTime(10, 0).atZone(BERLIN).toInstant(),
            saturday.atTime(10, 15).atZone(BERLIN).toInstant(),
            saturday.atTime(10, 30).atZone(BERLIN).toInstant()),
        slots(saturday, QUICK_CHAT_ID));
  }

  @Test
  void updatingReplacesOldStartsWithNewOnes() {
    LocalDate saturday = nextSaturday();
    RecurringWindowResponse created = create(List.of("SA"), "10:00", "11:00");
    assertFalse(slots(saturday, QUICK_CHAT_ID).isEmpty());

    LocalDate sunday = saturday.plusDays(1);
    RecurringWindowResponse updated =
        client
            .toBlocking()
            .retrieve(
                HttpRequest.PUT(
                    "/api/host/recurring-windows/" + created.id(),
                    new RecurringWindowRequest(List.of("SU"), "10:00", "11:00")),
                RecurringWindowResponse.class);
    assertEquals(List.of("SU"), updated.daysOfWeek());
    assertEquals(created.id(), updated.id());

    assertTrue(slots(saturday, QUICK_CHAT_ID).isEmpty());
    assertEquals(
        List.of(
            sunday.atTime(10, 0).atZone(BERLIN).toInstant(),
            sunday.atTime(10, 15).atZone(BERLIN).toInstant(),
            sunday.atTime(10, 30).atZone(BERLIN).toInstant()),
        slots(sunday, QUICK_CHAT_ID));
  }

  @Test
  void deletingRemovesTheAffectedStartsAndBlocksDirectBooking() {
    LocalDate saturday = nextSaturday();
    RecurringWindowResponse created = create(List.of("SA"), "10:00", "11:00");
    Instant start = slots(saturday, QUICK_CHAT_ID).get(0);

    client.toBlocking().exchange(HttpRequest.DELETE("/api/host/recurring-windows/" + created.id()));

    assertTrue(list().stream().noneMatch(window -> window.id() == created.id()));
    assertTrue(slots(saturday, QUICK_CHAT_ID).isEmpty());
    // The slot is gone server-side, not merely hidden: a hand-crafted booking is refused.
    assertStatus(409, HttpRequest.POST("/api/bookings", booking(start)));
  }

  @Test
  void existingBookingSurvivesDeletingItsWindow() {
    LocalDate saturday = nextSaturday();
    RecurringWindowResponse created = create(List.of("SA"), "10:00", "11:00");
    Instant start = slots(saturday, QUICK_CHAT_ID).get(0);

    BookingResponse booking =
        client
            .toBlocking()
            .retrieve(HttpRequest.POST("/api/bookings", booking(start)), BookingResponse.class);
    assertEquals("active", booking.state());

    client.toBlocking().exchange(HttpRequest.DELETE("/api/host/recurring-windows/" + created.id()));

    assertTrue(slots(saturday, QUICK_CHAT_ID).isEmpty());
    List<HostBookingResponse> hostBookings = hostBookings();
    HostBookingResponse surviving =
        hostBookings.stream()
            .filter(row -> row.guestEmail().equals("ada@example.com"))
            .findFirst()
            .orElseThrow();
    assertEquals(booking.bookingTypeId(), surviving.bookingTypeId());
    assertEquals("active", surviving.state());

    // Still cancellable: deleting availability never froze or altered the booking.
    BookingResponse cancelled =
        client
            .toBlocking()
            .retrieve(
                HttpRequest.create(
                    HttpMethod.POST, "/api/bookings/" + booking.cancellationToken() + "/cancel"),
                BookingResponse.class);
    assertEquals("cancelled", cancelled.state());
  }

  @Test
  void duplicateDaysAreDeduplicatedSilently() {
    RecurringWindowResponse created = create(List.of("SA", "SA"), "10:00", "11:00");
    assertEquals(List.of("SA"), created.daysOfWeek());
  }

  @Test
  void invalidInputIs400WithAUsefulDetail() {
    assertBadRequest(new RecurringWindowRequest(List.of(), "10:00", "11:00"), "at least one day");
    assertBadRequest(new RecurringWindowRequest(null, "10:00", "11:00"), "at least one day");
    assertBadRequest(new RecurringWindowRequest(List.of("XX"), "10:00", "11:00"), "unknown day");
    assertBadRequest(new RecurringWindowRequest(List.of("SA"), null, "11:00"), "startTime");
    assertBadRequest(new RecurringWindowRequest(List.of("SA"), "9:00", "11:00"), "startTime");
    assertBadRequest(new RecurringWindowRequest(List.of("SA"), "10:00", "25:00"), "endTime");
    assertBadRequest(new RecurringWindowRequest(List.of("SA"), "10:00", "10:00"), "cross midnight");
    assertBadRequest(new RecurringWindowRequest(List.of("SA"), "11:00", "10:00"), "cross midnight");
  }

  @Test
  void updatingOrDeletingAnUnknownIdIs404() {
    assertStatus(
        404,
        HttpRequest.PUT(
            "/api/host/recurring-windows/999999",
            new RecurringWindowRequest(List.of("SA"), "10:00", "11:00")));
    assertStatus(404, HttpRequest.DELETE("/api/host/recurring-windows/999999"));
  }

  // --- helpers -------------------------------------------------------------

  private List<RecurringWindowResponse> list() {
    return client
        .toBlocking()
        .retrieve(
            HttpRequest.GET("/api/host/recurring-windows"),
            new GenericArgument<List<RecurringWindowResponse>>() {});
  }

  private RecurringWindowResponse create(List<String> days, String start, String end) {
    return client
        .toBlocking()
        .retrieve(
            HttpRequest.POST(
                "/api/host/recurring-windows", new RecurringWindowRequest(days, start, end)),
            RecurringWindowResponse.class);
  }

  private List<HostBookingResponse> hostBookings() {
    return client
        .toBlocking()
        .retrieve(
            HttpRequest.GET("/api/bookings"), new GenericArgument<List<HostBookingResponse>>() {});
  }

  private List<Instant> slots(LocalDate date, long bookingTypeId) {
    return client
        .toBlocking()
        .retrieve(
            HttpRequest.GET("/api/slots?date=" + date + "&bookingTypeId=" + bookingTypeId),
            new GenericArgument<List<Instant>>() {});
  }

  private static CreateBookingRequest booking(Instant start) {
    return new CreateBookingRequest(
        start.toString(), QUICK_CHAT_ID, "Ada Lovelace", "ada@example.com");
  }

  private void assertBadRequest(RecurringWindowRequest body, String expectedDetail) {
    HttpClientResponseException ex =
        assertThrows(
            HttpClientResponseException.class,
            () ->
                client
                    .toBlocking()
                    .exchange(HttpRequest.POST("/api/host/recurring-windows", body)));
    assertEquals(400, ex.getStatus().getCode());
    String detail = ex.getResponse().getBody(String.class).orElse("");
    assertTrue(
        detail.contains(expectedDetail), () -> "expected '" + expectedDetail + "' in " + detail);
  }

  private void assertStatus(int expected, HttpRequest<?> request) {
    HttpClientResponseException ex =
        assertThrows(
            HttpClientResponseException.class, () -> client.toBlocking().exchange(request));
    assertEquals(
        expected,
        ex.getStatus().getCode(),
        () -> ex.getResponse().getBody(String.class).orElse(""));
  }

  /** A Saturday at least two days out, so the 1-hour notice never hides its slots. */
  private static LocalDate nextSaturday() {
    LocalDate date = LocalDate.now(BERLIN);
    for (int offset = 2; offset <= 8; offset++) {
      LocalDate candidate = date.plusDays(offset);
      if (candidate.getDayOfWeek() == DayOfWeek.SATURDAY) {
        return candidate;
      }
    }
    throw new IllegalStateException("no Saturday within a week");
  }
}
