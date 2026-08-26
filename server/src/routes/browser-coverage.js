// Which machines can actually be governed, and which have a hole.
//
// THE GAP THIS EXISTS TO MAKE VISIBLE. Chrome refuses an off-store force-install
// unless the machine is joined to an Active Directory domain or enrolled in Chrome
// Browser Cloud Management. Entra/Azure-AD join and Intune MDM do not satisfy it.
// On an Entra-only estate that means a machine can be fully provisioned — policy
// written, Intune reporting success — and still have a completely ungoverned
// Chrome. Nothing anywhere says so: the extension never installs, so it never
// enrolls, so its absence looks identical to a machine that simply has no Chrome.
//
// An absence cannot be measured from the outside, so the machine reports what it
// found. That turns "we think we cover everyone" into a list of the machines we
// demonstrably do not.
//
// This is deliberately NOT derived from the machines collection. A machine that
// enrolled tells us a browser IS governed; only the provisioning script can tell
// us a browser exists and is NOT.

import { a } from '../util.js';
import { ENROLL_SECRET, constantTimeEqual } from '../auth.js';

export function mountBrowserCoverage(app, db) {
  // Authenticated with the enroll secret rather than a machine token: this runs
  // from the provisioning script, before any extension exists to hold a token,
  // and it is the same credential that script already carries.
  app.post('/api/v1/browser-coverage', a(async (req, res) => {
    const b = req.body ?? {};
    if (!b.enrollSecret || !constantTimeEqual(String(b.enrollSecret), ENROLL_SECRET)) {
      return res.status(401).json({ error: 'invalid enrollSecret' });
    }
    if (!b.hostname) return res.status(400).json({ error: 'hostname required' });

    const doc = {
      hostname: String(b.hostname),
      os: b.os === 'macos' ? 'macos' : 'windows',
      user: b.user ? String(b.user) : null,
      extension_id: b.extension_id ? String(b.extension_id) : null,
      browsers: Array.isArray(b.browsers) ? b.browsers.map(String) : [],
      chrome_installed: !!b.chrome_installed,
      chrome_governable: !!b.chrome_governable,
      domain_joined: !!b.domain_joined,
      entra_joined: !!b.entra_joined,
      cbcm_token: !!b.cbcm_token,
      private_browsing_blocked: !!b.private_browsing_blocked,
      // Firefox needs a separate build and Mozilla signing, so its presence is a
      // permanent gap rather than something the next provisioning run fixes.
      firefox_installed: (Array.isArray(b.browsers) ? b.browsers : []).includes('firefox'),
      reported_at: new Date(),
    };

    // Keyed on hostname: this is current state, not history. A machine that gets
    // its CBCM token tomorrow should stop appearing as a gap, not accumulate rows
    // that make the estate look worse than it is.
    await db.collection('browser_coverage').updateOne(
      { hostname: doc.hostname, os: doc.os },
      { $set: doc, $setOnInsert: { first_reported_at: doc.reported_at } },
      { upsert: true },
    );
    res.json({ ok: true, gap: doc.chrome_installed && !doc.chrome_governable });
  }));

  // The estate view. Ordered so the actionable rows come first — a report an admin
  // has to sort themselves is a report nobody reads twice.
  app.get('/api/v1/browser-coverage', a(async (req, res) => {
    const rows = await db.collection('browser_coverage')
      .find({}).project({ _id: 0 }).toArray();

    const chromeGaps = rows.filter((r) => r.chrome_installed && !r.chrome_governable);
    const firefoxGaps = rows.filter((r) => r.firefox_installed);

    res.json({
      machines_reporting: rows.length,
      // The headline number: machines where a browser exists that we cannot govern.
      ungoverned_chrome: chromeGaps.length,
      ungoverned_firefox: firefoxGaps.length,
      private_browsing_open: rows.filter((r) => !r.private_browsing_blocked).length,
      fix: chromeGaps.length
        ? 'Set $ChromeCbcmToken in the provisioning script (admin.google.com → '
          + 'Devices → Chrome → Managed browsers → Enrollment token) and re-run it. '
          + 'Entra join alone does not satisfy Chrome; CBCM or AD domain join does.'
        : null,
      chrome_gap_machines: chromeGaps.map((r) => ({
        hostname: r.hostname, user: r.user, os: r.os,
        domain_joined: r.domain_joined, entra_joined: r.entra_joined,
        reported_at: r.reported_at,
      })),
      firefox_machines: firefoxGaps.map((r) => ({ hostname: r.hostname, user: r.user })),
      machines: rows,
    });
  }));
}
