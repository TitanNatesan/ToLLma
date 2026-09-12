# Testing Rules

## Goal

A test passes only when:

* The request succeeds as expected.
* The affected state changes correctly.
* No unexpected side effects occur.
* Logs and integrations behave correctly.

---

## Testing Workflow

1. Identify the feature being tested.
2. Identify impacted components.
3. Capture baseline state.
4. Execute the test.
5. Capture resulting state.
6. Compare before vs after.
7. Validate expected changes.
8. Validate no unexpected changes.
9. Review relevant logs.
10. Generate a report.

---

## Baseline Collection

Before testing, capture relevant state:

### Backend

* Endpoints
* Services
* Middleware

### Database

* Relevant records
* Counts
* Status fields
* Relationships

### Infrastructure

* Cache
* Queue
* Storage
* External integrations

### Frontend

* UI state
* Visible data

### Logs

* Current log position
* Recent entries

Never test without a baseline.

---

## Test Execution

Execute only the requested scenario.

Examples:

* Login
* Provider creation
* Chat request
* Dashboard load
* CRUD operations

Do not modify unrelated data.

---

## Validation

### Response

Verify:

* Status code
* Response schema
* Response values
* Authentication state
* Error handling

### State Changes

Verify:

* Expected records created
* Expected records updated
* Expected records deleted
* Expected status transitions

Verify no unrelated changes occurred.

### Database

Inspect affected tables and relationships.

### Logs

Verify:

* Expected events exist
* No unexpected errors exist

### Frontend

Verify:

UI Action

→ API Request

→ Backend Processing

→ Database Update

→ UI Refresh

→ Expected Result

---

## Failure Handling

On failure:

1. Identify failure point.
2. Collect logs.
3. Collect before/after state.
4. Determine root cause.
5. Report findings.

Never mark a test as PASS when validation is incomplete.

---

## Test Report

### Feature

Feature tested.

### Components

Affected components.

### Baseline State

State before execution.

### Test Steps

Actions performed.

### Response Validation

PASS / FAIL

### State Validation

PASS / FAIL

### Database Validation

PASS / FAIL

### Log Validation

PASS / FAIL

### Frontend Validation

PASS / FAIL

### Issues Found

List issues.

### Final Result

PASS / FAIL
