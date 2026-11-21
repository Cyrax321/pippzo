import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type ResetOtpResponse = {
  success: boolean;
  email: string;
  devOtp?: string | null;
  message: string;
};

export const requestPasswordResetOtp = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ email: z.string().trim().email() }).parse(data))
  .handler(async ({ data }): Promise<ResetOtpResponse> => {
    const email = data.email.trim().toLowerCase();
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Generate OTP and recovery link via Supabase Admin
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
      });

      if (linkError) {
        console.warn("[auth-otp] generateLink notice:", linkError.message);
        // For security, don't expose if account does not exist
        return {
          success: true,
          email,
          message: "If an account is associated with this email, a verification code has been sent.",
        };
      }

      const otp = linkData?.properties?.email_otp ?? null;
      console.log(`[auth-otp] Password reset OTP generated for ${email}: ${otp}`);

      return {
        success: true,
        email,
        devOtp: process.env.NODE_ENV !== "production" ? otp : null,
        message: "A 6-digit verification code has been sent to your email.",
      };
    } catch (err) {
      console.error("[auth-otp] Exception generating OTP:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to send reset code");
    }
  });

export const resolveUserIdentifier = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    const raw = typeof input === "object" && input !== null && "data" in input ? (input as any).data : input;
    return z.object({ identifier: z.string().trim() }).parse(raw);
  })
  .handler(async ({ data }): Promise<{ email: string }> => {
    const raw = (data?.identifier || "").trim();
    if (!raw) return { email: "" };
    if (raw.includes("@")) {
      return { email: raw.toLowerCase() };
    }
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const filter = `email.ilike.${raw}@%,full_name.ilike.%${raw}%`;
      const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("email, full_name")
        .or(filter)
        .limit(1);

      if (!error && profiles && profiles.length > 0 && profiles[0].email) {
        return { email: profiles[0].email.toLowerCase() };
      }
    } catch (e) {
      console.warn("[auth] username lookup exception:", e);
    }
    return { email: raw.toLowerCase() };
  });
