# Agentic DevSecOps Workflow

This workflow integrates AI-assisted development with secure SDLC thinking.

Each task must move through structured stages.

---

## Stage 0 – Task Definition

Input:
- Clear problem statement
- Scope definition
- Acceptance criteria

Security checkpoint:
- Does this feature affect authentication, data processing, or external exposure?
- Which CIA dimension is impacted?

---

## Stage 1 – Architect Agent

Responsibilities:
- Define solution approach
- Identify affected components
- Identify security-sensitive areas
- Define validation requirements
- Define test strategy

Deliverables:
- Implementation plan
- File impact list
- Identified risk surface
- CIA impact classification

---

## Stage 2 – Implementer Agent

Responsibilities:
- Write clean, minimal implementation
- Follow project conventions
- Avoid overengineering
- Ensure input validation
- Avoid insecure defaults

Deliverables:
- Code changes
- Comments where reasoning matters

Security rule:
Never trust external input.

---

## Stage 3 – Reviewer Agent

Responsibilities:
- Code quality review
- Architectural consistency
- Naming clarity
- Edge case awareness

Security focus:
- Missing validation?
- Authorization issues?
- Error leakage?
- Hardcoded secrets?

---

## Stage 4 – Tester Agent

Responsibilities:
- Define edge cases
- Negative tests
- Invalid input tests
- Authorization tests (if relevant)

Security note:
Test failure paths explicitly.

---

## Stage 5 – Security Agent

Responsibilities:
- Mini threat model
- OWASP-style reasoning
- Dependency risk awareness
- Risk register entry (if needed)

Deliverables:
- Identified threat vectors
- Risk severity (Low / Medium / High)
- Mitigation notes

---

## Stage 6 – Release Agent

Responsibilities:
- Ensure Definition of Done is met
- Update documentation
- Confirm CI passes
- Confirm no unresolved security flags

---

## Definition of Done

A task is not complete unless:

- Functional requirements met
- Tests written and passing
- Security review performed
- Risk considered
- No unresolved critical findings