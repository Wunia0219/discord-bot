import packageInfo from '../package.json' with { type: 'json' };

// App releases are changed only when the user specifies a new version.
// This is independent of the model IDs used to replay settled rounds.
export const APP_VERSION = packageInfo.version;
