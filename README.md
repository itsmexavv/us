# Tap Card

An NFC card that opens a private little page when it's tapped with a phone. The page shows a live "together for" counter, a reason I love you and a photo that change every day, a short note, our song, and special messages on monthiversaries, the anniversary and any dates you add.

**The card is the key.** Everything personal is encrypted (AES-256-GCM) before it's uploaded. The key lives only in the link stored on the card, after the `#`, and browsers never send that part to the server. So the public site and the public repo show nothing but a "tap the card" screen. After the first tap, her phone remembers the key.

## How it fits together

| Where | What | Uploaded? |
|---|---|---|
| `../anniversary-book/content.js` and `photos/` | her name, start date, reasons, love letter, photos: shared with the printed book | no |
| `content/tap.js` | card-only extras: note, song, extra reasons, special dates, countdown | no |
| `content/photos/` | extra photos just for the card | no |
| `secret.key` | the key (made on the first build) | **never** |
| `TAG-URL.txt` | the link to write to the card | no |
| `docs/` | the website (GitHub Pages serves this folder) | yes |
| `docs/payload.bin` | everything personal, encrypted | yes |

## Everyday use

```
npm install        once
npm run build      after changing any words or photos
npm test           unit tests
npm run check      safety checks: nothing private in docs/ or in git, link fits the card
npm run smoke      opens the page in headless Edge on a phone-sized screen; saves smoke-*.png
npm run serve      preview on this PC; prints the unlocked link
npm run label      makes the card sticker PDFs
```

To publish a change: `npm run build`, `npm run check`, then commit and push. GitHub Pages updates in about a minute. **The card never needs rewriting**, because the key stays the same.

To preview a special day, add `?date=YYYY-MM-DD` before the `#`, e.g. `http://localhost:8123/?date=2026-12-05#k=...`.

## Writing the words

1. Fill in the book first (`../anniversary-book/content.js`). Her name, the start date, the twelve reasons and the letter come from there.
2. Then fill in `content/tap.js`: a short note for the card, the song link, more reasons (one shows per day, so 30+ is nice), and special dates.
3. Run `npm run build`. It lists every `[placeholder]` still left and says **Ready to give** once there are none.

Photos: JPG, PNG or WebP. Convert iPhone HEIC photos to JPG first. They are resized to 1280 px automatically.

## Writing the card

Use white PVC NFC cards, **NTAG215 or NTAG216** (NTAG213 works too: the link is 74 bytes, an NTAG213 holds 137).

1. Install **NFC Tools** (free, iPhone or Android).
2. **Write** → **Add a record** → **URL / URI**. Paste the whole link from `TAG-URL.txt`, starting `https://`.
3. Tap **Write** and hold the card to the phone (top edge on iPhone, the middle of the back on most Androids).
4. Test it: lock and unlock your phone, then tap the card. iPhone XS and newer show a banner; Android needs NFC switched on.

Don't use NFC Tools' **Lock** option. Locking is permanent, and you can't fix the card afterwards.

Keep the card away from metal: MagSafe wallets, foil and metal phone plates all block NFC.

## The sticker

`npm run label` makes:
- `card-label.pdf`: one card face, 85.6 × 54 mm plus 2 mm bleed, for a print shop
- `card-label-sheet.pdf`: eight on A4 with cut lines, for sticker paper at home (print at 100 %)

## Keep `secret.key` safe

Back it up somewhere private, such as a password manager. If it's lost: delete it, run `npm run build`, push, and write the new `TAG-URL.txt` to the card. The old card stops working.

If the link ever leaks, do the same, so the old link stops opening anything.

## If something's off

- **"This card does not open this page"**: the card holds a different key from `secret.key`. Rewrite the card from `TAG-URL.txt`.
- **Locked screen with no message**: the page was opened without the card's link (e.g. typed in by hand). Tap the card.
- **"Could not load"**: no internet. The page needs a connection to fetch its content.
- **Home-screen icon asks for the card**: on iPhone, home-screen web apps don't share Safari's storage. Open the page by tapping the card, then use Share → Add to Home Screen from that page; the link it saves includes the key.
