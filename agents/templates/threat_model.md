# Threat Model (Lightweight)

## 1. System Overview
What are we building? Include high-level diagram/description.

## 2. Assets
What must be protected?
- User data:
- Credentials/tokens:
- Secrets/keys:
- Availability:

## 3. Entry Points
How can an attacker interact with it?
- API endpoints:
- UI forms:
- File uploads:
- CLI args:
- External integrations:

## 4. Trust Boundaries
Where does trust change?
- Client ↔ Server
- Server ↔ Database
- Server ↔ Third-party API
- CI/CD ↔ Runtime

## 5. Threats (STRIDE style, optional)
- Spoofing:
- Tampering:
- Repudiation:
- Information disclosure:
- Denial of service:
- Elevation of privilege:

## 6. Mitigations
What controls exist / will be added?
- Input validation:
- AuthN/AuthZ:
- Rate limiting:
- Secure headers/CORS:
- Secrets management:
- Logging/monitoring:

## 7. Residual Risk & Decision
- Residual risk: Low / Medium / High
- Accepted by:
- Notes: