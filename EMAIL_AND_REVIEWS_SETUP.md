# Reviews and Brevo staff email

## Apply the database changes

From the Sparkle project directory, link the existing Supabase project if needed, then apply the migration:

```sh
supabase link --project-ref ddvzobvioyulvchokvwo
supabase db push
```

The migration creates the private review queue and its row-level security rules, adds the customer user ID to bookings, and installs database triggers for signup and booking notifications. Approved reviews are publicly readable; only signed-in customers can submit reviews, and only admins can approve, reject, or delete them.

## Configure Brevo and deploy the email function

In Brevo, create/verify the sender address you want Sparkle to use, and create an API key. Then set the Edge Function secrets (never put these values in HTML or commit them):

```sh
supabase secrets set BREVO_API_KEY='your-brevo-api-key' BREVO_SENDER_EMAIL='verified-sender@example.com' BREVO_SENDER_NAME='Sparkle Laundry' SPARKLE_STAFF_EMAIL='vundingui844@gmail.com' SPARKLE_NOTIFICATION_WEBHOOK_SECRET='a-long-random-secret'
supabase functions deploy sparkle-staff-email
```

Create matching secrets in the Supabase SQL Editor so the database triggers can invoke the deployed function. Replace the URL with your project's function URL and use exactly the same random secret set above:

```sql
select vault.create_secret('https://ddvzobvioyulvchokvwo.supabase.co/functions/v1/sparkle-staff-email', 'sparkle_notification_function_url');
select vault.create_secret('a-long-random-secret', 'sparkle_notification_webhook_secret');
```

The function is deployed without JWT verification because database `pg_net` requests are authenticated using the shared secret header. It rejects requests without that secret and only sends the two expected event types. Brevo API details remain in Supabase secrets. The staff inbox receives name, email and phone on account creation, and those details plus service, pickup location and requested date on each booking.

## Customer reviews

Customers log in at `review.html` with their existing account, select a 1–5 star rating, and leave a comment. New reviews stay pending. Admins can approve or reject them in the staff portal; approved reviews then appear in the Customer stories section on the homepage. The review form is linked from the homepage footer and the reviews section.
