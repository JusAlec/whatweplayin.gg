const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'WhatWePlayin <noreply@whatweplayin.gg>';

export async function sendMagicLinkEmail(
  apiKey: string,
  toEmail: string,
  magicLinkUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const html = `
    <!doctype html>
    <html>
      <body style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 40px auto; color: #333; padding: 0 20px;">
        <h1 style="color: #e50914;">Sign in to WhatWePlayin</h1>
        <p>Click the button below to sign in. This link expires in 15 minutes.</p>
        <p style="margin: 30px 0;">
          <a href="${magicLinkUrl}" style="background: #e50914; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 600; display: inline-block;">Sign in</a>
        </p>
        <p style="color: #888; font-size: 14px;">If you didn't request this email, you can safely ignore it.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #aaa; font-size: 12px;">WhatWePlayin · Game-night decisions for groups · whatweplayin.gg</p>
      </body>
    </html>`.trim();

  const res = await fetchImpl(RESEND_API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [toEmail],
      subject: 'Sign in to WhatWePlayin',
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}
