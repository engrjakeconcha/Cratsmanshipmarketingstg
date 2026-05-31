import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PasswordForm } from "@/components/password-form";
import { getAuthCookieName, isAuthenticated } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(getAuthCookieName())?.value;
  const params = await searchParams;

  if (await isAuthenticated(cookieValue)) {
    redirect("/");
  }

  return (
    <PasswordForm
      error={params.error ? "Incorrect password. Please try again." : undefined}
    />
  );
}
