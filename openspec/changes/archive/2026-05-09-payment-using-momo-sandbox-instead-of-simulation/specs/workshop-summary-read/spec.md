## MODIFIED Requirements

### Requirement: Workshop detail read API exposes summary state consistently
The system SHALL expose workshop summary fields and registration-facing checkout context in read APIs for student web clients.

#### Scenario: Read workshop with generated summary and payment context
- **GIVEN** workshop has `summary_status=ready`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `pdf_url`, `ai_summary`, `summary_status`, `summary_generated_at`, `payment_required`, and registration-facing seat availability fields used by checkout CTA decisions

#### Scenario: Read workshop during processing
- **GIVEN** workshop has `summary_status=processing`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `summary_status=processing` and clients MUST NOT receive stale previous summary

## ADDED Requirements

### Requirement: Student checkout CTA aligns with redirect payment flow
The workshop read + student UX contract MUST support MoMo redirect checkout instead of simulation action.

#### Scenario: Paid workshop with available seats
- **WHEN** client reads a paid published workshop with available seats
- **THEN** frontend MUST render registration CTA that leads to provider checkout redirect flow after registration API response

#### Scenario: Full workshop regardless of payment mode
- **WHEN** workshop has no available seats
- **THEN** frontend MUST disable paid/free registration CTA consistently and MUST NOT expose payment redirect action
