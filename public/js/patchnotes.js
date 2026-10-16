/* Patch notes shown to players in-game. Newest first. Bump `version` with every release. */
window.EK_PATCH_NOTES = [
  {
    version: '1.2.0',
    date: '16 Oct 2026',
    title: 'Your progress is safe + the economy rework 🪙',
    sections: [
      {
        heading: '🔒 Progress protection',
        items: [
          'Sorry! The last update wiped online progress. That can never happen again: the server now refuses to run without its permanent database.',
          'Every device now keeps a tamper-proof backup of your online and Career progress. If the server ever loses your profile, it is restored automatically.',
          'New: set a password in Profile, then log in with your kicker name on any device.',
        ],
      },
      {
        heading: '🪙 Coins that flow',
        items: [
          'Coins and XP are now paid after every kick, not just at the end of the round. Watch the COINS counter tick up.',
          'Level-ups happen mid-round and pay their bonus straight away.',
          'New daily streak: your first round each day pays 50 coins × your streak (up to 350 coins on day 7+).',
        ],
      },
      {
        heading: '📈 The long grind',
        items: [
          'Upgrade prices now climb with every level: early levels are quick, but levels 6–10 are serious goals.',
          'Cosmetics cost more, so top-tier gear is a real flex.',
          'A round now pays 1 coin per 8 points (was 6), plus a 20-coin completion bonus.',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    date: '16 Oct 2026',
    title: 'Career Mode & Henry joins the pond! 🪿',
    sections: [
      {
        heading: '🏆 New: Career Mode',
        items: [
          'Take on 12 bosses across 4 tiers: Amateur League, Semi-Pro Circuit, Pro Tour and Legends.',
          'Every match is head-to-head on the same 10 balls. Beat a boss to unlock the next one.',
          'Wins raise your Skill Level and losses lower it. Reach 1,000 to go PRO and earn the Mastery Pro Ball.',
          'First win against each boss pays a coin bounty.',
        ],
      },
      {
        heading: '🪿 Henry has arrived',
        items: [
          'Henry now lives at the Duck Pond. Stop the ball there and he celebrates.',
          "New: the Henry Ball (level 6) and the Henry's Feathers trail (level 13).",
          'Henry keeps Jason company on the main menu, and he is the first Career boss.',
        ],
      },
      {
        heading: '🗺️ Bigger map',
        items: [
          'The field now runs to 17 km to match fully upgraded kickers.',
          'New targets: Gas Station, Ski Lodge, Lighthouse, Volcano, Rocket Launch Pad and the Moon Base jackpot (2,500 pts).',
        ],
      },
      {
        heading: '📈 Constant progression',
        items: [
          'Upgrades now go to level 10, with new tiers unlocking all the way to level 22.',
          'Level-ups now pay bonus coins.',
          '22 milestones with one-time coin rewards. See them in Locker → Milestones.',
          '13 new items: outfits, balls and trails unlock almost every level up to 30.',
          'The end-of-round screen shows exactly how your coins were earned and what unlocks next.',
        ],
      },
      {
        heading: '🔧 Fixes',
        items: [
          'Fixed legs clipping through the Click Wise Tee and Green Polo.',
          'Suits and the Astronaut outfit now have proper trousers and shoes.',
          'Scores no longer appear (in the live feed or the room standings) before your kick has finished.',
          'Added a "How coins work" guide to the shop and the How to Play screen.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '15 Oct 2026',
    title: 'Kick off!',
    sections: [
      {
        heading: '⚽ Launch',
        items: [
          'Eggers Kick Off is live: time your kick and boot the ball toward the Click Wise Design office.',
          'Ranked rounds, leaderboards, multiplayer rooms, challenge links, replays, and offline Casual & Free Kick.',
        ],
      },
    ],
  },
];
