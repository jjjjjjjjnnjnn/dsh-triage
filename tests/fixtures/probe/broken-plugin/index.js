// Throws at import time, before `apply` is ever reached.
//
// Deliberately not a `process.exit()` or an infinite loop: an import failure is what a
// real "my tool vanished after the upgrade" case looks like, and it leaves a stack trace
// the probe can attribute to this exact row.
throw new Error('triage-probe-fixture-broken: intentional import failure for the probe red path')
