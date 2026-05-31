import { NextRequest, NextResponse } from "next/server";
import {
  createAuthCookieValue,
  getAuthCookieName,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");

  if (!(await verifyPassword(password))) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), {
      status: 303,
    });
  }

  const response = NextResponse.redirect(new URL("/", request.url), {
    status: 303,
  });
  response.cookies.set({
    name: getAuthCookieName(),
    value: await createAuthCookieValue(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: getAuthCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
