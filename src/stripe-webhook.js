/**
 * Stripe webhook signature verification
 * 
 * IMPORTANT: This module requires server-side execution with access to the
 * Stripe webhook secret. Never expose the webhook secret to the browser.
 * 
 * Deploy this verification at the edge (e.g., Cloudflare Worker, Vercel Edge Function)
 * before invoking any BriteLink payment processing logic.
 */

/**
 * Verifies a Stripe webhook signature using the official algorithm.
 * 
 * @param {string} payload - The raw request body as a string
 * @param {string} signature - The Stripe-Signature header value
 * @param {string} secret - The Stripe webhook signing secret (whsec_...)
 * @param {number} tolerance - Maximum age in seconds (default 300)
 * @returns {Promise<{verified: boolean, event: object | null, error: string | null}>}
 */
export async function verifyStripeWebhook(payload, signature, secret, tolerance = 300) {
  if (!payload || typeof payload !== "string") {
    return { verified: false, event: null, error: "Invalid payload format" };
  }
  if (!signature || typeof signature !== "string") {
    return { verified: false, event: null, error: "Missing or invalid signature header" };
  }
  if (!secret || !secret.startsWith("whsec_")) {
    return { verified: false, event: null, error: "Invalid webhook secret format" };
  }

  // Parse the signature header
  const signatureParts = signature.split(",").reduce((acc, part) => {
    const [key, value] = part.split("=");
    if (key && value) acc[key] = value;
    return acc;
  }, {});

  const timestamp = signatureParts.t;
  const expectedSignature = signatureParts.v1;

  if (!timestamp || !expectedSignature) {
    return { verified: false, event: null, error: "Malformed signature header" };
  }

  // Check timestamp tolerance
  const currentTime = Math.floor(Date.now() / 1000);
  if (currentTime - parseInt(timestamp, 10) > tolerance) {
    return { verified: false, event: null, error: "Webhook timestamp is too old" };
  }

  // Verify the signature
  try {
    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload)
    );
    const computedSignature = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (computedSignature !== expectedSignature) {
      return { verified: false, event: null, error: "Signature verification failed" };
    }

    // Parse the event
    const event = JSON.parse(payload);
    return { verified: true, event, error: null };
  } catch (error) {
    return { verified: false, event: null, error: error.message };
  }
}

/**
 * Environment flag check for webhook verification.
 * 
 * @param {object} env - Environment variables object
 * @returns {boolean} True if webhook verification should be enabled
 */
export function isWebhookVerificationEnabled(env) {
  return env.BRITELINK_STRIPE_WEBHOOK_VERIFICATION_ENABLED === "true";
}

/**
 * Safe webhook secret retrieval from environment.
 * 
 * @param {object} env - Environment variables object
 * @returns {string | null} The webhook secret or null if not configured
 */
export function getWebhookSecret(env) {
  const secret = env.BRITELINK_STRIPE_WEBHOOK_SECRET;
  if (!secret || !secret.startsWith("whsec_")) {
    console.warn("Stripe webhook secret is not properly configured");
    return null;
  }
  return secret;
}

/**
 * Example edge function handler using this verification module.
 * 
 * @example
 * export default {
 *   async fetch(request, env) {
 *     if (request.method !== "POST") {
 *       return new Response("Method not allowed", { status: 405 });
 *     }
 * 
 *     const payload = await request.text();
 *     const signature = request.headers.get("stripe-signature");
 *     const secret = getWebhookSecret(env);
 * 
 *     if (!isWebhookVerificationEnabled(env)) {
 *       console.warn("Webhook verification is disabled - processing unverified event");
 *       // In development/testing only - never in production
 *     } else {
 *       if (!secret) {
 *         return new Response("Webhook secret not configured", { status: 500 });
 *       }
 *       
 *       const result = await verifyStripeWebhook(payload, signature, secret);
 *       if (!result.verified) {
 *         console.error("Webhook verification failed:", result.error);
 *         return new Response("Webhook verification failed", { status: 400 });
 *       }
 *       
 *       // Process result.event here
 *     }
 * 
 *     return new Response("Webhook received", { status: 200 });
 *   }
 * }
 */
