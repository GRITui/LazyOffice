// electron-builder afterSign hook: notarize the app with Apple — but ONLY when
// signing credentials are present in the environment. With no credentials (the
// default today, before an Apple Developer ID exists) this is a clean no-op, so
// `npm run dist` still produces the current unsigned build without failing.
//
// To enable notarization once you have a "Developer ID Application" cert in your
// keychain, set these env vars and run `npm run dist`:
//   APPLE_ID=you@example.com
//   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx   (appleid.apple.com → App-Specific Passwords)
//   APPLE_TEAM_ID=XXXXXXXXXX                          (developer.apple.com → Membership)
// or, using an App Store Connect API key instead of an Apple ID:
//   APPLE_API_KEY=/path/to/AuthKey_XXXX.p8  APPLE_API_KEY_ID=XXXX  APPLE_API_ISSUER=uuid
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const hasAppleId = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
  const hasApiKey = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
  if (!hasAppleId && !hasApiKey) {
    console.log('[notarize] no Apple credentials in env — skipping notarization (unsigned build).');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  // Lazy-require so the dependency is only needed when actually notarizing.
  const { notarize } = require('@electron/notarize');

  const opts = { appPath: appPath };
  if (hasApiKey) {
    opts.appleApiKey = process.env.APPLE_API_KEY;
    opts.appleApiKeyId = process.env.APPLE_API_KEY_ID;
    opts.appleApiIssuer = process.env.APPLE_API_ISSUER;
  } else {
    opts.appleId = process.env.APPLE_ID;
    opts.appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
    opts.teamId = process.env.APPLE_TEAM_ID;
  }

  console.log('[notarize] submitting ' + appPath + ' to Apple — this can take several minutes…');
  await notarize(opts);
  console.log('[notarize] done — the app is notarized and will open with a normal double-click.');
};
