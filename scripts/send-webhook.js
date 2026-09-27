const fs = require('node:fs');
const stripe = require('stripe');

const [file, ...flags] = process.argv.slice(2);
const forge = flags.includes('--forge');
const url = `${process.env.BASE_URL || 'http://localhost:3000'}/webhooks/stripe`;

const payload = fs.readFileSync(file, 'utf8');
const signature = stripe.webhooks.generateTestHeaderString({
  payload,
  secret: forge ? 'whsec_wrong_secret' : process.env.STRIPE_WEBHOOK_SECRET,
});

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
  body: payload,
}).then(async (res) => {
  console.log(`${forge ? 'FORGED' : 'signed'} -> HTTP ${res.status}`, await res.text());
});