const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sparkle-webhook-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const esc = (value: unknown) => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]!));

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  const expectedSecret = Deno.env.get('SPARKLE_NOTIFICATION_WEBHOOK_SECRET');
  if (!expectedSecret || request.headers.get('x-sparkle-webhook-secret') !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL');
  const recipient = Deno.env.get('SPARKLE_STAFF_EMAIL') || 'vundingui844@gmail.com';
  if (!brevoKey || !senderEmail) return Response.json({ error: 'Email service is not configured' }, { status: 500, headers: corsHeaders });

  let data: Record<string, unknown>;
  try { data = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders }); }
  if (!['account_created','booking_created'].includes(String(data.event)) || !data.email || !data.name) {
    return Response.json({ error: 'Invalid notification payload' }, { status: 400, headers: corsHeaders });
  }
  const isBooking = data.event === 'booking_created';
  const subject = isBooking ? `New Sparkle booking: ${String(data.name)}` : `New Sparkle customer account: ${String(data.name)}`;
  const fields: Array<[string, unknown]> = isBooking
    ? [['Name',data.name],['Email',data.email],['Phone',data.phone],['Service',data.service],['Pickup location',data.location],['Preferred date',data.preferred_date],['Submitted',data.created_at]]
    : [['Name',data.name],['Email',data.email],['Phone',data.phone],['Account created',data.created_at]];
  const html = `<div style="font:15px Arial,sans-serif;color:#123232"><h2>${esc(subject)}</h2><table cellpadding="8" cellspacing="0" style="border-collapse:collapse">${fields.map(([label,value]) => `<tr><th align="left" style="border-bottom:1px solid #dce9e4">${esc(label)}</th><td style="border-bottom:1px solid #dce9e4">${esc(value)}</td></tr>`).join('')}</table></div>`;
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoKey, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ sender: { name: Deno.env.get('BREVO_SENDER_NAME') || 'Sparkle Laundry', email: senderEmail }, to: [{ email: recipient }], subject, htmlContent: html }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('Brevo send failed', response.status, detail);
    return Response.json({ error: 'Brevo could not send the notification' }, { status: 502, headers: corsHeaders });
  }
  return Response.json({ sent: true }, { headers: corsHeaders });
});
