# Domotik

A sandbox for home automation.

## Execute

```bash
cd public
python3 -m http.server 8080
```

Or use any other local server.

Then, open <http://localhost:8080>.

Whistle transcribes the microphone locally and Needle maps the transcript to the
available home-automation commands. Both models are included in `public/models`.

## Commands

- Turn the living-room, kitchen, and garden lights on or off.
- Start or cancel a countdown timer.
- Add, remove, or clear notes.
