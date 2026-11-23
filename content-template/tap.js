// Words that only appear on the tap card.
// Her name, your start date, the reasons, the love letter and the photos are taken from
// the anniversary book (../anniversary-book) automatically, so you only write them once.
// Anything in [square brackets] is a placeholder: `npm run build` lists every one left.
//
// This file lives in content/, which is never uploaded. Only the encrypted version is.

window.TAP = {
  // The short note on the card's page. Set to null to show the book's love letter instead.
  // Greeting and signature fall back to "Hi <her name>," and your name from the book.
  note: {
    greeting: null,
    paragraphs: [
      "[A few lines just for the card: something she can read on an ordinary Tuesday.]"
    ],
    signoff: "Always yours,",
    signature: null
  },

  // The "our song" button: a Spotify, YouTube or Apple Music link. Leave url empty to hide it.
  song: { label: "[Song title]", url: "" },

  // More reasons, shown after the book's twelve. One shows each day, in this order,
  // then it starts again: 30 keeps it fresh for a month, 365 for a whole year.
  extraReasons: [
    "[Reason 13]",
    "[Reason 14]",
    "[Reason 15]"
  ],

  // Messages for particular days, written "MM-DD": "message".
  // Monthiversaries, the anniversary and every 100th day get a message automatically.
  specialDates: {
    "02-14": "[A Valentine's Day message]"
    // "07-21": "Happy birthday, ..."
  },

  // A countdown to your next plan together, e.g. { date: "2026-12-24", label: "Christmas dinner" }.
  // It disappears by itself once the day has passed. null hides it.
  nextDate: null,

  // Captions for photos you put in content/photos, by file name, e.g. { "beach.jpg": "Our first trip" }.
  // Photos from the book use that month's title.
  photoCaptions: {}

  // To override what comes from the book, add any of:
  // herName: "...", yourName: "...", startDate: "YYYY-MM-DD"
};
