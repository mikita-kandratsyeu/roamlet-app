# Security policy

## Supported versions

Security fixes target the latest code on the `main` branch. Older commits and deployments are not maintained separately; update to the latest code and redeploy to receive fixes.

## Reporting a vulnerability

Report suspected vulnerabilities privately to **[nickondr.production@gmail.com](mailto:nickondr.production@gmail.com)**. Do not open public issues or pull requests containing vulnerability details, secrets or personal data.

Include:

- The affected commit or deployment version and relevant component.
- A description of the issue, its potential impact and prerequisites.
- Minimal reproduction steps using synthetic routes and test accounts where needed.
- Redacted logs or screenshots, and a suggested fix if available.

Never send API keys, OAuth tokens, passwords, session cookies, backup passphrases, private route coordinates or unredacted backups. If a credential has been exposed, revoke or rotate it rather than including it in the report.

The maintainer will review reports and coordinate remediation and disclosure through the private reporting channel. No response or fix deadline is guaranteed. Please allow time for investigation and a fix before publishing details.

## Responsible testing

Test only systems and accounts you own or have explicit permission to assess. Prefer a local deployment and synthetic data. Do not access other users' data, disrupt shared deployments, exhaust provider quotas or test third-party services without their permission.

## Deployment and data safety

- Keep provider credentials server-side and out of browser builds and source control.
- Use HTTPS for production and configure deployment access controls, API rate limits and quota monitoring before public access.
- Keep dependencies and deployments up to date. Export important local routes before testing data recovery or storage changes.
- Optional cloud connectors require their own credential and session configuration; local workflows must remain available without them.

See [deployment and API protection](docs/deployment.md), [cloud connections](docs/connections.md), [local storage and backups](docs/storage.md), and [safe contribution reports](CONTRIBUTING.md#safe-reports-and-examples) for operational guidance.
