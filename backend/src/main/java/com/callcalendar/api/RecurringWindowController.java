package com.callcalendar.api;

import com.callcalendar.service.RecurringWindowService;
import io.micronaut.http.HttpResponse;
import io.micronaut.http.annotation.Body;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Delete;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.PathVariable;
import io.micronaut.http.annotation.Post;
import io.micronaut.http.annotation.Put;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;

/**
 * Host-managed recurring availability (UC-1). Lists, creates, edits and deletes weekly windows;
 * slot generation reads the same rows, so changes are visible on the next browse.
 */
@Tag(name = "host-availability")
@Controller
public class RecurringWindowController {

  private final RecurringWindowService service;

  public RecurringWindowController(RecurringWindowService service) {
    this.service = service;
  }

  @Get("/api/host/recurring-windows")
  @Operation(summary = "List recurring availability windows", operationId = "listRecurringWindows")
  @ApiResponse(
      responseCode = "200",
      description = "Every window, ordered by id ascending",
      content =
          @Content(
              array =
                  @ArraySchema(schema = @Schema(implementation = RecurringWindowResponse.class))))
  public List<RecurringWindowResponse> list() {
    return service.list().stream().map(RecurringWindowResponse::from).toList();
  }

  @Post("/api/host/recurring-windows")
  @Operation(
      summary = "Create a recurring availability window",
      operationId = "createRecurringWindow")
  @ApiResponse(
      responseCode = "201",
      description = "The created window",
      content = @Content(schema = @Schema(implementation = RecurringWindowResponse.class)))
  @ApiResponse(
      responseCode = "400",
      description = "Missing or invalid days/times (including a window crossing midnight)",
      content =
          @Content(
              mediaType = "application/problem+json",
              schema = @Schema(implementation = ProblemDetail.class)))
  public HttpResponse<RecurringWindowResponse> create(@Body RecurringWindowRequest body) {
    return HttpResponse.created(
        RecurringWindowResponse.from(
            service.create(body.daysOfWeek(), body.startTime(), body.endTime())));
  }

  @Put("/api/host/recurring-windows/{id}")
  @Operation(
      summary = "Update a recurring availability window",
      operationId = "updateRecurringWindow")
  @ApiResponse(
      responseCode = "200",
      description = "The updated window",
      content = @Content(schema = @Schema(implementation = RecurringWindowResponse.class)))
  @ApiResponse(
      responseCode = "400",
      description = "Missing or invalid days/times (including a window crossing midnight)",
      content =
          @Content(
              mediaType = "application/problem+json",
              schema = @Schema(implementation = ProblemDetail.class)))
  @ApiResponse(
      responseCode = "404",
      description = "No recurring window with this id",
      content =
          @Content(
              mediaType = "application/problem+json",
              schema = @Schema(implementation = ProblemDetail.class)))
  public RecurringWindowResponse update(@PathVariable long id, @Body RecurringWindowRequest body) {
    return RecurringWindowResponse.from(
        service.update(id, body.daysOfWeek(), body.startTime(), body.endTime()));
  }

  @Delete("/api/host/recurring-windows/{id}")
  @Operation(
      summary = "Delete a recurring availability window",
      operationId = "deleteRecurringWindow")
  @ApiResponse(responseCode = "204", description = "Window deleted")
  @ApiResponse(
      responseCode = "404",
      description = "No recurring window with this id",
      content =
          @Content(
              mediaType = "application/problem+json",
              schema = @Schema(implementation = ProblemDetail.class)))
  public HttpResponse<?> delete(@PathVariable long id) {
    service.delete(id);
    return HttpResponse.noContent();
  }
}
