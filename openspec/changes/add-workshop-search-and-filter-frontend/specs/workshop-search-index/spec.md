## ADDED Requirements

### Requirement: Workshop search index tracks searchable workshop visibility
The system SHALL maintain an Elasticsearch-backed workshop search index that reflects the searchable content and visibility of workshops exposed to student discovery.

#### Scenario: Published workshop becomes searchable after create or update
- **GIVEN** organizer creates or updates a workshop whose discovery-visible fields change and the workshop is eligible for public listing
- **WHEN** the indexing flow processes the workshop-changed event
- **THEN** the system MUST upsert the workshop search document so subsequent search requests can discover the updated workshop

#### Scenario: Draft or cancelled workshop is removed from search visibility
- **GIVEN** a workshop becomes `draft` or `cancelled`
- **WHEN** the indexing flow processes the workshop-changed event
- **THEN** the system MUST remove or suppress that workshop from public search results

### Requirement: Workshop search indexing is idempotent and retryable
The system MUST tolerate repeated indexing attempts for the same workshop without creating duplicate search visibility.

#### Scenario: Repeated indexing of the same workshop state
- **GIVEN** the same workshop change is delivered to the indexing flow more than once
- **WHEN** the system processes repeated indexing attempts
- **THEN** the effective search document state MUST converge to a single correct representation for that workshop

#### Scenario: Temporary indexing failure
- **GIVEN** the indexing flow cannot write to Elasticsearch on the first attempt
- **WHEN** the job is retried
- **THEN** the system MUST retry indexing without requiring the organizer to re-submit the workshop change

### Requirement: Search index supports bootstrap and rebuild
The system SHALL provide a way to populate or rebuild the workshop search index from canonical workshop records.

#### Scenario: Initial index bootstrap
- **GIVEN** Elasticsearch index is empty or newly created
- **WHEN** operators run the supported bootstrap or rebuild flow
- **THEN** the system MUST populate search documents for currently relevant workshops from authoritative workshop records
