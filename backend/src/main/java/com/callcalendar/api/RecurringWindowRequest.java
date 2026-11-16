package com.callcalendar.api;

import io.micronaut.core.annotation.Nullable;
import io.micronaut.serde.annotation.Serdeable;
import java.util.List;

/**
 * Body of POST/PUT /api/host/recurring-windows. Days use RFC 5545 two-letter codes; times are
 * host-local {@code HH:mm}. Fields are nullable because input is untrusted.
 */
@Serdeable
public record RecurringWindowRequest(
    @Nullable List<String> daysOfWeek, @Nullable String startTime, @Nullable String endTime) {}
