# Contributing to StackDeployer

Thanks for helping improve StackDeployer.

## Before you start
- Open an issue or describe the change you want to make.
- Keep changes focused and small when possible.
- Do not commit generated build output unless it is part of the requested change.

## Local setup
- Backend: `backend/`
- Frontend: `frontend/`
- Update script: `update-server.sh`

## Development workflow
1. Create a branch for your work.
2. Make the smallest change that solves the problem.
3. Run the relevant checks:
   - Frontend: `cd frontend && npm run build`
   - Backend syntax check: `python -m py_compile backend/app/*.py backend/app/routers/*.py` or run the project tests if available
4. Update docs when behavior changes.
5. Open a pull request with a short description of the change and validation steps.

## Style
- Prefer clear, direct code.
- Match the existing naming and formatting conventions.
- Avoid unrelated refactors in the same change.

## Reporting bugs
Include:
- What you expected
- What happened instead
- The exact URL, endpoint, or command used
- Relevant logs or screenshots if available
