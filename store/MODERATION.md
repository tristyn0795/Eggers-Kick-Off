# Moderation: handling reports

Players can report names and chat. Apple and Google expect you to act on reports, ideally
within 24 hours. You do it with a few admin commands.

## One-time setup

1. Make a long random admin token. On a Mac or Linux terminal: `openssl rand -hex 24`
   (or use any password manager's generator, 40+ characters).
2. Railway → the game service → **Variables** → add `ADMIN_TOKEN` = that value → deploy.
3. Keep the token private, like a password. Without `ADMIN_TOKEN` the admin endpoints are switched off.

In the commands below, replace `$ADMIN_TOKEN` with your token (or `export ADMIN_TOKEN=...` first).

```bash
SITE=https://eggers-kick-off-production.up.railway.app
```

## See open reports

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$SITE/api/admin/reports"
# all reports, including handled ones:
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$SITE/api/admin/reports?status=all"
```

Each report shows the reported player's `reportedId` and name, the reason (`name`, `chat`,
`cheating`, `other`), and the chat message if one was reported.

## Act on a player

```bash
# Give them a neutral name ("Kicker 12345"); they can pick a new one
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"rename"}' "$SITE/api/admin/players/PLAYER_ID"

# Ban: removed from leaderboards, the live feed and multiplayer (they can still play solo)
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"ban"}' "$SITE/api/admin/players/PLAYER_ID"

# Undo a ban
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"unban"}' "$SITE/api/admin/players/PLAYER_ID"
```

## Close the report

```bash
# "resolved" = you took action, "dismissed" = nothing wrong
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"resolved"}' "$SITE/api/admin/reports/REPORT_ID"
```

## The word filter

`src/moderation.js` holds the blocked word lists. Add words there if players find a way around
it, and add a test in `test/moderation.test.js` to make sure normal words still pass.
