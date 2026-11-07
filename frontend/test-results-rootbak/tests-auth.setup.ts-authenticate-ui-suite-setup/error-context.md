# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/auth.setup.ts >> authenticate ui suite
- Location: tests/auth.setup.ts:8:6

# Error details

```
AggregateError: apiRequestContext.post: connect ECONNREFUSED ::1:8000
connect ECONNREFUSED 127.0.0.1:8000
Call log:
  - → POST http://localhost:8000/auth/signup
    - user-agent: Playwright/1.63.0 (x64; alpine 3.24.4) node/22.23
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 87

```