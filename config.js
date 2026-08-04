// ---------------------------------------------------------------
// 1) Go to your Firebase project -> Project settings -> General
//    -> "Your apps" -> Web app -> copy the firebaseConfig object
//    and paste it below, replacing everything inside {}.
// ---------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDOdRNEvFcFzozGi-yhmbRU6xqroRN0nTs",
  authDomain: "view-and-earn-8717f.firebaseapp.com",
  projectId: "view-and-earn-8717f",
  storageBucket: "view-and-earn-8717f.firebasestorage.app",
  messagingSenderId: "291096119352",
  appId: "1:291096119352:web:66e019fd1c726752c17ecd"
};

// ---------------------------------------------------------------
// 2) Paste your 5 website links here, in order. These are what
//    each "stop" button opens.
// ---------------------------------------------------------------
const STOP_URLS = [
  "https://omg10.com/4/11497407",
  "https://omg10.com/4/11372970",
  "https://omg10.com/4/11432960",
  "https://omg10.com/4/11434970",
  "https://omg10.com/4/11364819"
];

// Short labels shown on each stop card (edit freely)
const STOP_LABELS = ["Stop 1", "Stop 2", "Stop 3", "Stop 4", "Stop 5"];

// ---------------------------------------------------------------
// 3) Campaign settings
// ---------------------------------------------------------------
const CAMPAIGN_START = "2026-08-05"; // YYYY-MM-DD, first day of the 30-day season
const CAMPAIGN_DAYS = 30;
const POINTS_PER_STOP = 25;          // points earned per stop click
const POINTS_PER_REFERRAL = 500;     // points earned when someone signs up with your code
