# Frontend Rules

Use Next.js App Router.

Keep reusable components centralized.

Example:

src/components/

Button
Input
Modal
Card
Table

Global reusable UI only.

---

Page-specific components must stay near the page.

Example:

app/chat/

components/

ChatInput
ChatMessage
ChatSidebar

These components must not be moved into global components.

---

Styling Rules

Keep styles close to components.

Prefer:

- Tailwind
- Component composition

Avoid:

- Large global css files
- Repeated class strings

---

Create reusable hooks whenever logic is shared.

Use:

hooks/

services/

lib/

for shared functionality.