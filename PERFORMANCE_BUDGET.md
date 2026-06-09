# LynxDock Performance Budget

LynxDock should feel meaningfully lighter than Discord on modest hardware.
These budgets are release targets, not marketing claims. Measure them on a
fresh launch after the app has been idle for 60 seconds.

## Desktop Client

| Scenario | Target |
| --- | --- |
| Connected, idle, no active room | Under 200 MB total working set |
| Connected, idle, no active room | Under 1% average CPU |
| Hidden to tray | No active rendering loops; under 0.5% average CPU |
| Second launch | Restores the existing process; never creates another client |

## Self-Hosted Server

| Scenario | Target |
| --- | --- |
| SQLite server, idle | Under 150 MB RSS |
| SQLite server, idle | Under 1% average CPU |
| Idle WebSocket clients | No measurable memory growth after disconnect |
| Dead client cleanup | Removed within 60 seconds |
| Unauthenticated connection | Closed within 10 seconds |

## Calls And Screen Sharing

| Scenario | Target |
| --- | --- |
| Default screen share | 720p at 30 FPS |
| Efficiency screen share | 480p at 15 FPS |
| Hidden or unwatched video | Paused or reduced to the lowest practical rate |
| Muted microphone | Audio track disabled; no speaking events |

## Release Check

Before publishing a desktop or server release:

1. Record idle client memory and CPU after 60 seconds.
2. Confirm closing to tray stops visible rendering work.
3. Confirm a second desktop launch focuses the existing window.
4. Connect and abruptly terminate a test client; confirm the server removes it.
5. Leave the server idle for 30 minutes and check that memory remains stable.
