// Usage: node scripts/generate-vapid-keys.ts
// Prints a new VAPID key pair for YOU to store in GitHub Secrets (VAPID_PRIVATE_KEY) and in the PWA build
// configuration (the public key). Nothing is written to disk. Never paste the private key into a chat or commit.
import { generateVAPIDKeys } from 'web-push'

const { publicKey, privateKey } = generateVAPIDKeys()
console.log('Store these yourself. The private key is a secret.\n')
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log('\nAlso set VAPID_SUBJECT to mailto:you@example.com (or an https URL you control).')
