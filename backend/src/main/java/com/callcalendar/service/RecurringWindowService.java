package com.callcalendar.service;

import com.callcalendar.domain.RecurringWindow;
import com.callcalendar.repo.RecurringWindowRepository;
import io.micronaut.core.annotation.Nullable;
import jakarta.inject.Singleton;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import net.fortuna.ical4j.model.Recur;

/**
 * Write-side seam for weekly availability (UC-1): validates the host's day/time shape and projects
 * it onto the stored {@code dtstart_local}/{@code dtend_local}/{@code rrule} columns. Availability
 * expansion keeps reading the repository directly, so a saved window takes effect on the next slot
 * browse with no cache to invalidate.
 */
@Singleton
public class RecurringWindowService {

  /** Monday-to-Sunday order; also the only accepted RFC 5545 day codes. */
  private static final List<String> DAY_ORDER = List.of("MO", "TU", "WE", "TH", "FR", "SA", "SU");

  /** Monday of the canonical reference week the seeded window also uses. */
  private static final LocalDate REFERENCE_MONDAY = LocalDate.of(2026, 1, 5);

  private static final DateTimeFormatter HH_MM =
      DateTimeFormatter.ofPattern("HH:mm").withResolverStyle(ResolverStyle.STRICT);

  private final RecurringWindowRepository repository;

  public RecurringWindowService(RecurringWindowRepository repository) {
    this.repository = repository;
  }

  public List<RecurringWindow> list() {
    return repository.findAll();
  }

  public RecurringWindow create(
      @Nullable List<String> daysOfWeek, @Nullable String startTime, @Nullable String endTime) {
    Schedule schedule = schedule(daysOfWeek, startTime, endTime);
    return repository.insert(schedule.dtstartLocal(), schedule.dtendLocal(), schedule.rrule());
  }

  public RecurringWindow update(
      long id,
      @Nullable List<String> daysOfWeek,
      @Nullable String startTime,
      @Nullable String endTime) {
    Schedule schedule = schedule(daysOfWeek, startTime, endTime);
    return repository
        .update(id, schedule.dtstartLocal(), schedule.dtendLocal(), schedule.rrule())
        .orElseThrow(() -> notFound(id));
  }

  public void delete(long id) {
    if (!repository.deleteById(id)) {
      throw notFound(id);
    }
  }

  /**
   * Reads the stored recurrence's day list back out using iCal4j's own parse, then returns the
   * codes deduplicated in Monday-to-Sunday order.
   */
  public static List<String> daysOfWeek(RecurringWindow window) {
    Set<String> stored = new LinkedHashSet<>();
    for (var weekDay : new Recur<ZonedDateTime>(window.rrule()).getDayList()) {
      stored.add(dayCode(String.valueOf(weekDay.getDay())));
    }
    return DAY_ORDER.stream().filter(stored::contains).toList();
  }

  public static String startTime(RecurringWindow window) {
    return HH_MM.format(window.dtstartLocal().toLocalTime());
  }

  public static String endTime(RecurringWindow window) {
    return HH_MM.format(window.dtendLocal().toLocalTime());
  }

  private static Schedule schedule(
      @Nullable List<String> daysOfWeek, @Nullable String startTime, @Nullable String endTime) {
    List<String> days = normaliseDays(daysOfWeek);
    LocalTime start = parseTime("startTime", startTime);
    LocalTime end = parseTime("endTime", endTime);
    if (!end.isAfter(start)) {
      throw new InvalidRequestException(
          "endTime must be after startTime; a window cannot cross midnight");
    }
    // Anchor on the earliest selected weekday of the reference week so DTSTART always belongs to
    // BYDAY and expansion never produces a spurious occurrence.
    LocalDate anchor = REFERENCE_MONDAY.plusDays(DAY_ORDER.indexOf(days.get(0)));
    String rrule = "FREQ=WEEKLY;BYDAY=" + String.join(",", days) + ";WKST=MO";
    return new Schedule(LocalDateTime.of(anchor, start), LocalDateTime.of(anchor, end), rrule);
  }

  private static List<String> normaliseDays(@Nullable List<String> raw) {
    if (raw == null || raw.isEmpty()) {
      throw new InvalidRequestException("daysOfWeek must contain at least one day");
    }
    Set<String> unique = new LinkedHashSet<>();
    for (String day : raw) {
      if (day == null) {
        throw new InvalidRequestException("daysOfWeek must contain valid day codes");
      }
      String code = day.trim().toUpperCase(Locale.ROOT);
      if (!DAY_ORDER.contains(code)) {
        throw new InvalidRequestException("unknown day code: " + day);
      }
      unique.add(code);
    }
    return DAY_ORDER.stream().filter(unique::contains).toList();
  }

  private static LocalTime parseTime(String field, @Nullable String raw) {
    if (raw == null) {
      throw new InvalidRequestException(field + " must be HH:mm");
    }
    try {
      return LocalTime.parse(raw, HH_MM);
    } catch (DateTimeParseException e) {
      throw new InvalidRequestException(field + " must be HH:mm");
    }
  }

  private static String dayCode(String raw) {
    String upper = raw.trim().toUpperCase(Locale.ROOT);
    String code = upper.length() >= 2 ? upper.substring(0, 2) : upper;
    if (!DAY_ORDER.contains(code)) {
      throw new IllegalStateException("stored rrule has an unsupported day: " + raw);
    }
    return code;
  }

  private static RecurringWindowNotFoundException notFound(long id) {
    return new RecurringWindowNotFoundException("no recurring window with id " + id);
  }

  private record Schedule(LocalDateTime dtstartLocal, LocalDateTime dtendLocal, String rrule) {}
}
