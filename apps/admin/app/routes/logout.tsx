import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";

export async function action(_: ActionFunctionArgs) {
  return redirect("/login", {
    headers: {
      "Set-Cookie": "admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    },
  });
}

export async function loader() {
  return redirect("/login");
}
