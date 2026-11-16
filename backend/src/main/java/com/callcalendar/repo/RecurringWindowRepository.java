package com.callcalendar.repo;

import com.callcalendar.domain.RecurringWindow;
import jakarta.inject.Singleton;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * Reads and writes the {@code recurring_window} table. Availability expansion reads every row; the
 * host Availability page uses the same table for CRUD. Times are stored as host-local wall-clock
 * timestamps and recurrence lives in {@code rrule} (docs/domain.md: recurring window).
 */
@Singleton
public class RecurringWindowRepository {

  private static final String COLUMNS = "id, dtstart_local, dtend_local, rrule";

  private final DataSource dataSource;

  public RecurringWindowRepository(DataSource dataSource) {
    this.dataSource = dataSource;
  }

  public List<RecurringWindow> findAll() {
    try (Connection connection = dataSource.getConnection();
        PreparedStatement statement =
            connection.prepareStatement(
                "SELECT " + COLUMNS + " FROM recurring_window ORDER BY id");
        ResultSet rs = statement.executeQuery()) {
      List<RecurringWindow> windows = new ArrayList<>();
      while (rs.next()) {
        windows.add(read(rs));
      }
      return windows;
    } catch (SQLException e) {
      throw new IllegalStateException("failed to read recurring_window", e);
    }
  }

  public Optional<RecurringWindow> findById(long id) {
    try (Connection connection = dataSource.getConnection();
        PreparedStatement statement =
            connection.prepareStatement(
                "SELECT " + COLUMNS + " FROM recurring_window WHERE id = ?")) {
      statement.setLong(1, id);
      try (ResultSet rs = statement.executeQuery()) {
        return rs.next() ? Optional.of(read(rs)) : Optional.empty();
      }
    } catch (SQLException e) {
      throw new IllegalStateException("failed to read recurring_window", e);
    }
  }

  public RecurringWindow insert(
      LocalDateTime dtstartLocal, LocalDateTime dtendLocal, String rrule) {
    try (Connection connection = dataSource.getConnection();
        PreparedStatement statement =
            connection.prepareStatement(
                "INSERT INTO recurring_window (dtstart_local, dtend_local, rrule) VALUES (?, ?, ?)",
                Statement.RETURN_GENERATED_KEYS)) {
      statement.setTimestamp(1, Timestamp.valueOf(dtstartLocal));
      statement.setTimestamp(2, Timestamp.valueOf(dtendLocal));
      statement.setString(3, rrule);
      statement.executeUpdate();
      try (ResultSet keys = statement.getGeneratedKeys()) {
        keys.next();
        return new RecurringWindow(keys.getLong(1), dtstartLocal, dtendLocal, rrule);
      }
    } catch (SQLException e) {
      throw new IllegalStateException("failed to insert recurring_window", e);
    }
  }

  /**
   * Replaces every editable field; returns the new state, or empty when the row was deleted under
   * the host's feet.
   */
  public Optional<RecurringWindow> update(
      long id, LocalDateTime dtstartLocal, LocalDateTime dtendLocal, String rrule) {
    try (Connection connection = dataSource.getConnection();
        PreparedStatement statement =
            connection.prepareStatement(
                "UPDATE recurring_window SET dtstart_local = ?, dtend_local = ?, rrule = ?"
                    + " WHERE id = ?")) {
      statement.setTimestamp(1, Timestamp.valueOf(dtstartLocal));
      statement.setTimestamp(2, Timestamp.valueOf(dtendLocal));
      statement.setString(3, rrule);
      statement.setLong(4, id);
      if (statement.executeUpdate() == 0) {
        return Optional.empty();
      }
      return Optional.of(new RecurringWindow(id, dtstartLocal, dtendLocal, rrule));
    } catch (SQLException e) {
      throw new IllegalStateException("failed to update recurring_window", e);
    }
  }

  public boolean deleteById(long id) {
    try (Connection connection = dataSource.getConnection();
        PreparedStatement statement =
            connection.prepareStatement("DELETE FROM recurring_window WHERE id = ?")) {
      statement.setLong(1, id);
      return statement.executeUpdate() > 0;
    } catch (SQLException e) {
      throw new IllegalStateException("failed to delete recurring_window", e);
    }
  }

  private static RecurringWindow read(ResultSet rs) throws SQLException {
    return new RecurringWindow(
        rs.getLong("id"),
        rs.getTimestamp("dtstart_local").toLocalDateTime(),
        rs.getTimestamp("dtend_local").toLocalDateTime(),
        rs.getString("rrule"));
  }
}
