# Test Coverage Audit

## Backend Endpoint Inventory
- Project type declaration at top of README: `ios` (`README.md:1`).
- Endpoint inventory result: **N/A (no HTTP API surface detected)**.
- Evidence:
  - README states offline iOS app with no network connectivity (`README.md:4`).
  - Static scan found no route/server declarations (`app.get/post`, router registration, Vapor/Express-style definitions) in `App/`, `Services/`, `Tests/`, `Package.swift`.

### Endpoint List (METHOD + PATH)
- **None (0 endpoints, API dimension N/A for this repository).**

## API Test Mapping Table
| Endpoint | Covered | Test Type | Test Files | Evidence |
|---|---|---|---|---|
| N/A (no HTTP endpoints) | N/A | Non-HTTP unit/integration | `Tests/*.swift` | `Tests/TestRunner.swift:8-59` runs service/viewmodel/flow suites; no HTTP request invocation |

## Coverage Summary
- Total endpoints: **0**
- Endpoints with HTTP tests: **0**
- Endpoints with true no-mock HTTP tests: **0**
- HTTP coverage %: **N/A**
- True API coverage %: **N/A**

## Unit Test Summary

### Backend Unit Tests
- Core backend/service suites are present and wired in runner:
  - `AuthServiceTests`, `SessionServiceTests`, `PermissionServiceTests`, `UserManagementServiceTests`
  - `LeadServiceTests`, `AppointmentServiceTests`, `NoteServiceTests`, `ReminderServiceTests`
  - `SLAServiceTests`, `InventoryServiceTests`, `CarpoolServiceTests`
  - `ExceptionServiceTests`, `AppealServiceTests`, `AuditServiceTests`
  - `StateMachineTests`, `CoreDataIntegrationTests`, `EncryptionTests`, `FileServiceTests`, `BackgroundTaskServiceTests`, `DebugSeederTests`
- Evidence:
  - Test runner includes all above suites (`Tests/TestRunner.swift:8-49`).
  - Example new coverage for previously missing modules:
    - Appointment: `Tests/AppointmentServiceTests.swift:testCreateAppointment`, `testUpdateStatusScheduledToConfirmed`, `testGetUnconfirmedWithinSLA`.
    - Note: `Tests/NoteServiceTests.swift:testAddNote`, `testGetOrCreateTagNormalized`, `testGetTagsForEntity`.
    - Reminder: `Tests/ReminderServiceTests.swift:testCreateReminder`, `testCompleteReminder`, `testFindByEntity`.
- Important backend modules NOT tested:
  - No clearly missing major service module from the current service set after this update.

### Frontend Unit Tests
- Project type is `ios` (not `fullstack`/`web`), so the strict web-frontend gate does not force a critical failure.
- Frontend-adjacent tests are present under UIKit guard:
  - `Tests/ViewModelTests.swift` (Lead/Inventory/Dashboard VMs)
  - `Tests/UIStateTransitionTests.swift` (view-state transitions/callback ordering)
  - `Tests/UIFlowTests.swift` (scenario flows via app services/container)
  - `Tests/NegativeUITests.swift` (negative/session/cross-site behaviors)
- Evidence:
  - Runner includes UI suites under `#if canImport(UIKit)` (`Tests/TestRunner.swift:50-59`).
  - ViewModel function-level coverage examples:
    - `testLoadLeadsEmptyState`, `testCreateLeadSuccess`, `testDashboardSessionExpired` in `Tests/ViewModelTests.swift`.
    - `testLeadViewModelLoadingThenLoadedState` in `Tests/UIStateTransitionTests.swift`.

**Mandatory verdict: Frontend unit tests: PRESENT**

### API Test Classification
1. True No-Mock HTTP: **0 (N/A)**
2. HTTP with Mocking: **0 (N/A)**
3. Non-HTTP (unit/integration without HTTP): **present and extensive**

### Mock Detection Rules Check
- No explicit mock/stub framework markers found (`jest.mock`, `vi.mock`, `sinon.stub`, `URLProtocol`, etc.).
- Static search result: no matches in `Tests/`, `App/`, `Services/`.
- Interpretation: tests use in-memory repositories and real service logic; classification remains non-HTTP integration/unit.

## Tests Check
- Strengths:
  - Very broad static test surface (288 `test*` functions across suites).
  - Expanded service completeness (Appointment/Note/Reminder now directly covered).
  - Added state-transition and negative-path checks for UI-facing ViewModels and flows.
  - CoreData integration suite remains in place.
- Weaknesses:
  - No real transport/API contract tests (N/A currently, but would be a gap if API is introduced later).
  - No XCTest/XCUITest device/simulator automation evidence (`XCUIApplication`/XCUITest patterns not detected).
  - `run_tests.sh` is local/macOS dependent and explicitly skips non-Darwin by exiting `0`, which can produce false-green CI on unsupported runners (`scripts/run_tests.sh:20-30`).

## Test Coverage Score (0–100)
**95/100**

## Score Rationale
- API dimension treated as N/A due verified absence of endpoint surface.
- High score from strong breadth/depth across service, persistence, viewmodel, state, and negative behavior tests.
- Deductions for missing true UI automation layer and runner behavior that can silently skip tests on non-macOS.

## Key Gaps
1. No XCTest/XCUITest end-to-end UI automation against actual screens/device runtime.
2. `scripts/run_tests.sh` exits successfully on non-macOS without executing tests (`exit 0`), risking false-positive CI status.
3. Test harness is custom (`TestHelpers`) rather than standard XCTest reporting, limiting native tooling integration and coverage artifacts.

## Confidence & Assumptions
- Confidence: **High** for static conclusions.
- Assumptions:
  - No hidden test targets outside inspected tree.
  - No runtime-generated route layer exists outside source files.

## Test Coverage Verdict
**PASS (High), with remaining quality-hardening gaps**

---

# README Audit

## High Priority Issues
1. README test instructions still claim Docker test execution path (`README.md:43-49`), but `scripts/run_tests.sh` now states non-macOS is unsupported and exits without running tests (`scripts/run_tests.sh:20-30`). This is a documentation/runtime contradiction.

## Medium Priority Issues
1. README states swiftc-absent hosts auto-delegate to Docker (`README.md:41`), but script now requires local `swiftc` and exits with install guidance (`scripts/run_tests.sh:33-39`).

## Low Priority Issues
1. Add a short CI policy note clarifying which runners are authoritative (macOS only) and how non-macOS jobs should report status.

## Hard Gate Failures
- None.

## README Verdict (PASS / PARTIAL PASS / FAIL)
**PASS**

## Hard-Gate Evidence Summary
- README location exists: `README.md`.
- Project type declared at top: `ios` (`README.md:1`).
- Startup instructions for iOS/Xcode present (`README.md:15-27`).
- Access method for simulator/device present (`README.md:21-27`, `README.md:63-74`).
- Verification walkthrough present (`README.md:95-147`).
- Demo credentials for all roles present (`README.md:80-86`).
- No forbidden runtime package-install commands documented in README.
