package com.callcalendar.api;

import com.callcalendar.domain.RecurringWindow;
import com.callcalendar.service.RecurringWindowService;
import io.micronaut.serde.annotation.Serdeable;
import java.util.List;

/**
 * A recurring window as the host edits it: RFC 5545 day codes in Monday-to-Sunday order and
 * host-local {@code HH:mm} times. The stored rrule/dates are an implementation detail.
 */
@Serdeable
public record RecurringWindowResponse(
    long id, List<String> daysOfWeek, String startTime, String endTime) {

  public static RecurringWindowResponse from(RecurringWindow window) {
    return new RecurringWindowResponse(
        window.id(),
        RecurringWindowService.daysOfWeek(window),
        RecurringWindowService.startTime(window),
        RecurringWindowService.endTime(window));
  }
}
