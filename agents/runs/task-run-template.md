# Task Run: <Feature Name>

## Date
YYYY-MM-DD

---

# 1. Objective

Describe what this change accomplishes.

---

# 2. Scope

Affected modules/routes/components:

- 
- 
- 

---

# 3. Architectural Decision

## Strategy

Explain chosen approach and why.

## Alternatives Considered

Briefly note if relevant.

---

# 4. Security Review

## CIA Impact

Confidentiality:
Integrity:
Availability:

---

## OWASP-style Check (light)

- Input validation:
- AuthN/AuthZ:
- Sensitive data exposure:
- Misconfiguration:
- Logging gaps:

---

# 5. Dependency & Supply Chain

New dependencies added? (Yes/No)

If yes:
- Why?
- Alternatives?
- Version strategy?

Audit command:
npm audit --audit-level=high

Result:
<output summary>

---

# 6. Testing

Tests added:
- 
- 

Negative cases covered:
- 
- 

Command:
npm test

Result:

---

# 7. Definition of Done

✔ Feature implemented  
✔ Tests passing  
✔ Audit clean  
✔ No regressions  
✔ Documentation updated  

Status: <Draft / Review / Ready for merge>