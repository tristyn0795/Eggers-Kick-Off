# Age ratings and review notes

## Google Play: content rating (IARC questionnaire)

Category: **Game**. Answers:

| Question | Answer |
| --- | --- |
| Violence (any kind, including cartoon/fantasy) | No |
| Blood, gore | No |
| Sexuality, nudity | No |
| Language: profanity or crude humour | No (chat is filtered; "Watters Creek Bathrooms" is a landmark name, not crude humour) |
| Controlled substances (drugs, alcohol, tobacco) | No |
| Gambling: real or simulated | No. Kick Crates are earned free in play, with random coin amounts. They can't be bought, and coins have no cash value. If a question asks about randomized rewards/loot boxes, answer **Yes, but not purchasable**. |
| Fear / horror | No |
| **Do users interact or exchange content?** | **Yes** (multiplayer room chat and public nicknames) |
| Does the app share the user's current location? | No |
| Does the app allow purchases of digital goods? | No |
| Is the app a web browser or search engine? | No |

Expected result: **Everyone / PEGI 3 / USK 0**, with the interactive element **"Users Interact"**.

**Target audience** (App content → Target audience): **13 and over** (13–15, 16–17, 18+).
Choosing under-13 would bring in the Families policy and COPPA rules, which don't suit public chat.
If asked "could the app unintentionally appeal to children?", answer **No** and point to the
13+ target, chat moderation and the absence of child-directed marketing.

## Apple: age rating questionnaire

Answer **None** for every content frequency question (violence, horror, mature themes, profanity,
sexual content, drugs/alcohol, simulated gambling, medical). Then:

| Capability question | Answer |
| --- | --- |
| Unrestricted web access | No |
| User-generated content | **Yes** (nicknames) |
| Messaging and chat | **Yes** (multiplayer rooms) |
| Advertising | No |
| Parental controls / age assurance | No |
| Loot boxes | **Yes, if asked** (free Kick Crates with random coin amounts; not purchasable) |

Apple calculates the rating from these answers. Chat and user content usually move a game above
4+; expect around **9+ to 13+**. That's fine for this game.

## Apple: App Review information

**Sign-in required?** No. Use this text in the *Notes* box:

```
No account is needed. Casual Round and Free Kick work offline.

To test online features: tap "Play Online" and pick any kicker name (no email or password).
- Career, Leaderboard, Multiplayer Room and Daily & Weekly Challenges are on the main menu.
- Multiplayer: create a room on one device and join with the 4-letter code on another
  (or a simulator). Chat is in the room screen.

User-generated content safeguards (Guideline 1.2):
- Names and chat are filtered for objectionable words, including look-alike spellings.
- Tap "⋯" next to any player (leaderboard, room members, chat line) to Block or Report.
  Blocking hides that player's chat and posts immediately.
- Reports go to our moderation queue; we act within 24 hours and can rename or ban accounts.
- Terms of use (zero tolerance for objectionable content): in-app under How to play, and at
  https://eggers-kick-off-production.up.railway.app/terms.html

Account deletion (5.1.1(v)): Profile → Delete account → type the kicker name → Delete forever.

The game is bundled in the app and playable offline; the server is only used for online modes.
```

**Contact**: your name, phone and email for Apple's reviewer (not shown publicly).

## Apple: export compliance

Uses only standard HTTPS encryption → **exempt**. Set `ITSAppUsesNonExemptEncryption = NO` in
`Info.plist` (see `ios/README.md`) so App Store Connect stops asking.

## Apple: content rights

"Does your app contain, show, or access third-party content?" **No**. All art is drawn in code,
and the Allen landmarks are just names. (If you add real logos or photos later, you need permission.)
