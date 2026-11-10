# Raas & Kirtan — the stage first

GitHub-first 3D prototype for Voice of Vrindavan. The owner will add their own characters later, so **no human models are included or requested by the default page**. `characters.json` contains an empty array.

## Run locally

Run `npm start` from the repository root (no package installation, build, API key or cloud account required), then open `http://127.0.0.1:8080/`. Any static HTTP server also works. Do not open the HTML through `file://`, because browsers require HTTP for ES modules and model requests.

## Included now

- An orbitable 3D festival pandal inspired by the owner's stage photo: yellow, red and pink fabric canopy, draped backdrop, red wrapped posts, patterned carpet, pennants, hanging decorations, light bulbs and audience chairs.
- Three original synthesized instrumental sketches: Radhe (76 BPM), Hare Krishna (102 BPM), and Radha Govind (132 BPM). These are original flute-like, harmonium-like, drone and percussion demos, with no vocals or third-party recordings.
- Play/pause, track selection, volume, an immersion view, drag-to-orbit, wheel/pinch zoom and reduced motion. Music pauses when the page is hidden. Light levels respond gently to measured audio energy.
- Self-hosted JavaScript and assets; no microphone, model API or account is needed.
- Optional GLB character loading, clip crossfades and tempo synchronization, ready for owner-supplied models.

## Add characters later

Place an owned/licensed model in `models/`, then update `characters.json`. See [the model guide](models/README.md) for the exact configuration, supported format and animation names. The loader uses your supplied animations for dance, clap, kirtan and idle. It does not generate authentic raas motion from a static model or copy a dance from a video automatically.

The owner's local 9.8-second dance clip was inspected as a visual reference, showing frequent turns, alternating raised/curved arms and skirt flare; the feet are mostly hidden. Neither that clip nor its soundtrack is included. Character creation and motion matching were deferred at the owner's request.

## GitHub only

This branch is for source review. It has not been merged or deployed. The commit message begins `[CF-Pages-Skip]` to suppress Cloudflare automatic preview deployment. `main` continues to serve the original logo-only website.

When publication is requested later, merge with a new commit that does not contain the skip prefix, then verify the deployment. This branch changes the root entry page, so deployment will replace the current logo-only homepage.

## Verification limits

The scene and controls are checked in desktop/mobile browser viewports. That does not certify performance on a physical phone. Future model performance, licensing, clothing detail and motion fidelity depend on the assets added later. See [validation](VALIDATION.md) and [asset sources](ASSET-SOURCES.md).
