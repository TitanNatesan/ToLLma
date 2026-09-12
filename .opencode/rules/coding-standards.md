# Coding Standards

Always write production-grade code.

Avoid:

- duplicate code
- giant functions
- giant classes
- unnecessary abstractions

---

Functions

Prefer:

20-50 lines

Avoid:

200+ line functions

---

Services

One responsibility per service.

---

Error Handling

Every external call must:

- catch exceptions
- log errors
- return meaningful messages

Never:

except Exception:
    pass

---

Typing

Every function must use typing.

No untyped public APIs.