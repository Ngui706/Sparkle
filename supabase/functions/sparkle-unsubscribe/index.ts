const html = (title: string, message: string, status = 200) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Sparkle Laundry</title><body style="margin:0;padding:40px 18px;background:#f5faf7;color:#123232;font:16px Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:32px;border:1px solid #dce9e4;border-radius:16px;background:#fff"><h1>${title}</h1><p>${message}</p></main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

Deno.serve(async request => {
  if (!['GET','POST'].includes(request.method)) return html('Invalid request', 'Use the unsubscribe link from your Sparkle email.', 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secret = Deno.env.get('SPARKLE_UNSUBSCRIBE_SECRET');
  if (!supabaseUrl || !serviceKey || !secret) return html('Unavailable', 'We could not update your email preference right now. Please contact vundingui844@gmail.com.', 500);
  const params = request.method === 'GET'
    ? new URL(request.url).searchParams
    : new URLSearchParams(await request.text());
  const userId = params.get('user') || '';
  const providedSig = params.get('sig') || '';
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f]{64}$/i.test(providedSig)) return html('Invalid link', 'This unsubscribe link is invalid or incomplete.', 400);
  if (request.method === 'GET') {
    const action = new URL(request.url).origin + new URL(request.url).pathname;
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe | Sparkle Laundry</title><body style="margin:0;padding:40px 18px;background:#f5faf7;color:#123232;font:16px Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:32px;border:1px solid #dce9e4;border-radius:16px;background:#fff"><h1>Stop Sparkle promotion emails?</h1><p>Confirm below to unsubscribe from future Sparkle Laundry promotions.</p><form method="post" action="${action}"><input type="hidden" name="user" value="${userId}"><input type="hidden" name="sig" value="${providedSig}"><button style="padding:12px 18px;border:0;border-radius:8px;background:#0e847e;color:white;font-weight:bold">Unsubscribe</button></form></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = new Uint8Array(providedSig.match(/.{2}/g)!.map(part => parseInt(part, 16)));
  const valid = await crypto.subtle.verify('HMAC', hmacKey, signature, new TextEncoder().encode(userId));
  if (!valid) return html('Invalid link', 'This unsubscribe link is invalid or expired.', 400);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
  if (!userResponse.ok) return html('Could not update preference', 'Please email vundingui844@gmail.com and ask to unsubscribe from promotions.', 502);
  const user = await userResponse.json();
  const updateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ user_metadata: { ...(user.user_metadata || {}), marketing_opt_in: false } }),
  });
  if (!updateResponse.ok) return html('Could not update preference', 'Please email vundingui844@gmail.com and ask to unsubscribe from promotions.', 502);
  return html('You are unsubscribed', 'You will no longer receive Sparkle Laundry promotion emails.');
});
