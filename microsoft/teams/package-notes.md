# Teams Package Notes

This is a scaffold for a private Teams app and later AppSource submission.

## Packaged Pilot Artifact

- Package: `syncai-reliability-teams.zip`
- Refreshed: 2026-05-22 for private pilot sideload testing.
- App ID: `52a214dd-fb3e-4fd3-bc1a-4fd8549c612a`
- Entra application/client ID: `09b1f6e1-99b3-46f7-bb23-48b2aa4a6399`
- Live tab domain: `https://repo-lime-nu.vercel.app`
- Static tabs:
  - Reliability Copilot: `https://repo-lime-nu.vercel.app/demo/copilot?source=teams`
  - Pilot Brief: `https://repo-lime-nu.vercel.app/pilot/reliability?source=teams`
- Included icons:
  - `color.png`: 192 x 192 px full-color icon.
  - `outline.png`: 32 x 32 px transparent outline icon.

## Before AppSource Submission

- Move tab URLs from `repo-lime-nu.vercel.app` to `app.syncai.ca` after DNS is live.
- Configure the Entra App ID URI to match `webApplicationInfo.resource`.
- Verify the publisher profile/MPN ID so external tenants can grant consent to
  the multi-tenant Entra application.
- Add Azure Bot Service or a Teams bot endpoint before restoring bot commands,
  message extensions, file consent, and adaptive card submissions.
- Confirm privacy and terms URLs are live.

## Private Pilot Package

For a private customer pilot:

1. Create the Entra app registration.
2. Upload `syncai-reliability-teams.zip` to Teams admin center or sideload in a
   permitted pilot tenant.
3. Validate that the Reliability Copilot tab launches the live cowork demo and
   the Pilot Brief tab launches the public reliability pilot page.
4. Validate sign-in, tab launch, and the Reliability Copilot tab experience.
5. Add bot commands and message extensions after Azure Bot Service is created.

## Public Store Package

For Teams Store/AppSource:

- Use the production domain only.
- Remove dev/staging endpoints.
- Provide Microsoft validation test credentials.
- Provide clear admin setup notes.
- Provide data handling, deletion, and support instructions.
- Confirm marketplace listing copy matches app behavior exactly.
