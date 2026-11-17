package com.callcalendar.service;

/** No recurring window exists for the supplied id. */
public class RecurringWindowNotFoundException extends RuntimeException {

  public RecurringWindowNotFoundException(String message) {
    super(message);
  }
}
