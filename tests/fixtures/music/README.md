# Local-only music boundary fixtures

These two five-second MP3 excerpts come from the user-provided `lobby1.mp3` and `lobby2.mp3`, starting at00:30. FFmpeg encoded the test excerpts at96kbps,48kHz stereo with a new accurate duration header and no source metadata. They exercise real native media endings and crossfades without waiting four minutes or relying on Range seeking in the local Static Assets runtime.

Only the local Playwright media checkpoint routes these files in place of the full lobby tracks. Production UI and normal-UI music tests use the unchanged full files in `public/music/`. No server, game rule, clock or authentication behavior is modified by these fixtures.
