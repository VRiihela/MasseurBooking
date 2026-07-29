## Tooling commands
### Install
- pip install -r requirements.txt  (or uv/pdm/poetry)

### Lint
- ruff check .

### Format
- ruff format . (or black .)

### Test
- pytest -q

### Dependency audit
- pip-audit (or safety check)

### Type Check (if mypy configured)
- mypy .

### Run application
- python -m app   (or project-specific entrypoint)