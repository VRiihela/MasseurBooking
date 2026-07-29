# Example Task – Add Workout ID Validation

## Context
The GET /workouts/:id endpoint currently accepts any string.
Invalid ObjectIds cause cast errors at the database layer.

## Acceptance Criteria
- [ ] Invalid IDs return HTTP 400
- [ ] Valid IDs return workout or 404
- [ ] No database cast errors occur

## Scope
In scope:
- workout.routes.ts
- validation middleware

Out of scope:
- Database schema changes

## Affected Areas
- Express route layer
- Mongoose ObjectId validation

## Risk Assessment
- Security impact: Low (input validation improvement)
- Data sensitivity: None

## Selected Profile
- [x] Node/TS Backend

## Definition of Done
- Typescript compile clean
- Tests added for invalid ID
- Dependency audit passes (per selected profile)
- Security agent reviewed