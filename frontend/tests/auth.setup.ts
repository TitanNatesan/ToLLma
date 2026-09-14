// One-time UI-suite login. E2E specs manage their own users; this account
// stays empty forever so UI tests run against deterministic empty state.
import { test as setup } from "@playwright/test";
import { API } from "../e2e/helpers";

const STATE = "tests/.auth/state.json";

setup("authenticate ui suite", async ({ request }) => {
  const email = `pw-ux-${Date.now()}@tollma.ai`;
  const signup = await request.post(`${API}/auth/signup`, {
    data: { email, password: "password123" },
  });
  if (!signup.ok()) throw new Error(`ux setup signup failed: ${await signup.text()}`);
  const token = (await signup.json()).debug_verification_token as string | null;
  if (token) await request.get(`${API}/auth/verify`, { params: { token } });
  await request.storageState({ path: STATE });
});
