// One-shot seeder for the docker compose quickstart.
//
// Writes the RBAC config document that src/rbac/firestore.ts reads
// (rbac/config → { dev: [emails], leads: [emails] }) to the Firestore emulator.
// Idempotent — uses .set() so re-running just overwrites with the same data.

import admin from 'firebase-admin'

const emulatorHost = process.env['FIRESTORE_EMULATOR_HOST']
const projectId = process.env['FIRESTORE_PROJECT_ID']

if (!emulatorHost) {
  console.error('seed-firestore: FIRESTORE_EMULATOR_HOST is not set — refusing to run against real Firestore')
  process.exit(1)
}
if (!projectId) {
  console.error('seed-firestore: FIRESTORE_PROJECT_ID is not set')
  process.exit(1)
}

admin.initializeApp({ projectId })

const db = admin.firestore()

await db.collection('rbac').doc('config').set({
  leads: ['lead@example.com'],
  dev: ['viewer@example.com'],
})

console.log(`seed-firestore: wrote rbac/config to project "${projectId}" via emulator at ${emulatorHost}`)
console.log('  leads: lead@example.com')
console.log('  dev:   viewer@example.com')

process.exit(0)
