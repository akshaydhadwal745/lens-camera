// Privacy policy, terms and account deletion, English + Hindi.
// Facts here must match the product (checked against the code 2026-10-09, re-audited 2026-10-15
// for the Play Data safety form: docs/launch/play-store.md):
// AWS ap-south-1, S3 versioning (deleted versions kept 30 days), DynamoDB
// point-in-time recovery (35 days), API logs 7 days, no CloudFront/S3 access
// logs, Google scope openid+email+profile (only sub + email stored).
//
// Contact: the contact form only (user decision 2026-10-09: no postal address
// or public mailbox for now). Messages are emailed to the team.
// TODO (owner to confirm): legal entity name; Grievance Officer name if wanted.
import type { Lang } from '../i18n/ui';

export const LEGAL = {
  operator: 'InstaGrow',
  /** No public mailbox: the contact form (topic presets via ?topic=). */
  contact: 'lens.instagrowapp.com/contact/',
  grievance: 'lens.instagrowapp.com/contact/?topic=grievance',
  updated: { en: '26 October 2026', hi: '26 अक्टूबर 2026' },
};

export type LegalBlock = { h2: string; p?: string[]; ul?: string[]; table?: { head: string[]; rows: string[][] } };
export type LegalDoc = { title: string; description: string; h1: string; intro: string; blocks: LegalBlock[] };

const C = LEGAL.contact;
const G = LEGAL.grievance;

export const privacy: Record<Lang, LegalDoc> = {
  en: {
    title: 'Privacy policy',
    description: 'Exactly what Lens by InstaGrow collects, why, where it is stored, how long it is kept, who processes it, and your rights.',
    h1: 'Privacy policy',
    intro: `This policy explains how ${LEGAL.operator} ("we") handles personal data in the Lens app (Android and iPhone) and on lens.instagrowapp.com. It is written to comply with India's Digital Personal Data Protection Act, 2023 and the rules made under it. We collect only what we need to run Lens.`,
    blocks: [
      {
        h2: '1. What we collect and why',
        table: {
          head: ['Data', 'Why we need it', 'How long we keep it'],
          rows: [
            ['A random Lens name (like "quiet-tiger-8703")', 'To identify your account and let friends find you when you share', 'Until you delete your account'],
            ['Your name, if you add one (Settings → Your name; optional)', 'Shown next to your Lens name to people you share with, who share with you, or who scan your Lens code, so they recognise you. It is never searchable and isn’t shown to strangers who only search a Lens name', 'Until you remove it or delete your account'],
            ['Your email address (if you sign in with email or Google)', 'To sign you in with one-time codes and to recognise your account on new devices', 'Until you delete your account'],
            ['Your Google account ID (if you sign in with Google)', 'To sign you in with Google. Google also sends your name and profile photo: we keep the name only to suggest it in Settings → Your name (no one else sees it unless you save it there) and do not store the photo', 'Until you delete your account'],
            ['Photos and videos you back up, and their metadata (for example date, camera model and, if your camera recorded it, location)', 'To store, show, share and stream your library, the core of Lens', 'Until you delete them (see Trash and Archive below) or your account'],
            ['Only if you turn on "Back up my phone’s camera too" (Android): Lens reads the photos and videos in your phone’s camera folder (DCIM), never other folders such as WhatsApp or screenshots, and backs up new ones like photos taken in Lens. Turning it off stops this; Android’s photo permission can also be removed in the phone’s settings', 'To back up photos you take with any camera app', 'Same as photos and videos you back up'],
            ['Thumbnails, previews, edit settings, portrait outlines and streaming copies', 'To make browsing fast and show your edits on every device', 'Previews/edits: as long as the photo. Streaming copies: 90 days after last made'],
            ['Who you share items with', 'To show shared items to them', 'Until you or they remove the share'],
            ['Share links you make: which items, who may open them, when they expire, how often they were viewed and who opened them in Lens', 'So people without Lens can see what you sent, and so you can see and turn off your links. Only the items you picked are in a link, never an album or your library; location is removed unless you include it', 'Until the link expires or you turn it off, then 30 days'],
            ['Device and browser names (for example "Samsung SM-A546E", "Chrome on Windows") and sign-in times', 'To list your signed-in devices so you can sign them out', 'Until you sign that device out, or 90 days without use'],
            ['A one-way hash of your phone’s app ID', 'To give a reinstalled phone its free guest storage back instead of creating new free storage (abuse prevention)', 'Until you delete your account'],
            ['IP address', 'To limit abuse (counting requests per network for one hour)', 'About 2 hours'],
            ['Notification token (Android): an address Google gives this app on your phone so we can send you notifications (shares, invites, storage). Sent through Google Firebase Cloud Messaging', 'To notify you about things you asked for; you choose which in Settings → Notifications', 'Until you sign out on that phone, uninstall, or delete your account'],
            ['Places (only if you turn on "Save location"): the exact position is saved inside each photo file (like any camera; it stays in your backed-up originals), and for the Places view we keep it rounded to about 100 m with the nearest city', 'To group your own photos by place. People you share with get photos without the location unless you choose to include it', 'Until you delete the photo or your account'],
            ['Nearby (only if you turn on "Visible to nearby Lens users"): a random code that changes every few minutes, announced on your Wi-Fi while Lens is open', 'So people on the same Wi-Fi who also turned it on can find you by your Lens name. Only the code travels the network; we turn it into your Lens name, never your location', 'Each code expires after 15 minutes'],
            ['People (on by default in most countries; in the EU, UK and US only after you turn it on): face groups of your own Lens photos and the names you give them', 'Made and kept only on your phone to show your photos by person. Never sent to us, never in backups; the only download is the face model itself', 'Until you turn People off, which deletes it (uninstalling Lens deletes it too)'],
            ['Sharing: who you shared with and who shared with you, the status of each share (waiting, accepted, declined, cancelled, revoked, expired) and people you blocked', 'To let you accept or decline shares, cancel or revoke what you sent, and stop unwanted shares', 'Until you delete your account'],
            ['Approximate city (from your IP) when you request QR sign-in on the website', 'To show "who is asking" on your phone before you approve', 'At most 2 minutes'],
            ['Sign-in codes we email you', 'To verify you own the email address', '10 minutes; stored only as a hash'],
            ['Requests you send us (for example "add a storage provider", or the contact form: name, email, message, and a one-way hash of your IP address and browser to stop spam)', 'To reply and improve Lens', 'Up to 2 years'],
            ['Feedback you send in the app (Settings → Feedback): rating, review or message, its category, the email address only if you ask for a reply, your phone model and app version only if you leave that switch on, and screenshots only if you attach them (re-saved on your phone without photo details such as location; seen only by the Lens team)', 'To read and answer your feedback and improve Lens', 'Up to 2 years, or until you delete your account'],
            ['Quality Lab (only if you use Settings → Camera info → Quality Lab): the test photos you choose to send, with your phone model', 'To compare and improve photo quality on your kind of phone', 'Until you delete your account'],
            ['Invites: which invite or affiliate link or code brought you (from the Google Play install referrer, a website cookie, or a code you type), and whether your phone is an emulator', 'To give your friend their storage reward or the affiliate their commission, and to stop fake sign-ups', 'Until you delete your account'],
            ['Clicks on invite and affiliate links: time, browser type and a one-way hash of the IP address', 'Fraud checks and the inviter’s statistics (counts only, never who clicked)', 'Raw clicks 30 days; daily counts for the life of the link'],
            ['Affiliates only: name, channels, PAN and UPI ID (encrypted), commissions and payouts', 'To run the program, pay you and meet tax law (TDS, Form 16A)', '8 years after the financial year (Indian tax and accounting law)'],
            ['A record of reward, commission and payout changes', 'An unchangeable audit trail, so rewards and payments can be checked', '8 years'],
            ['Lens Plus and other payments: which plan you chose, Razorpay’s subscription and payment IDs, amounts, dates and status (active, cancelled, payment failed); with extra storage, the limit you chose and your daily storage above your plan. You pay on Razorpay’s own page: your card, UPI or bank details go to Razorpay, never to us', 'To give you the storage you paid for, remind you before charges, and keep tax and accounting records', '8 years after the financial year (Indian tax and accounting law)'],
            ['Anonymous camera diagnostics (Android): phone model and Android version, app build, how the camera started (photo and preview size, camera features used, errors), and once per app version and once a month a list of what the phone and its cameras support (memory, chip, lenses, resolutions, frame rates, video and photo features), with a random ID that changes every month so we can count phones, not reports. No photos, no location, not linked to your account or to earlier months. You can turn it off in Settings → Camera → Help improve Lens', 'To find and fix camera problems on phone models we cannot test ourselves, and to choose the best camera settings for each kind of phone', '1 year'],
            ['Crash reports (Android): when Lens crashes, freezes or hits an error, a report of where in the code it happened, the app build, phone model and Android version, and the steps inside Lens just before it (which screen, which button). No photos, no location, no screenshots, no IP address, not linked to your name or email. Sent through Sentry. Off together with Settings → Camera → Help improve Lens', 'To find and fix crashes and errors', '30 days'],
            ['How Lens is used: the days you use Lens (one record per day), and while Settings → Camera → Help improve Lens is on, how many times app features were used that day (for example "photos taken: 12", "editor opened: 2"), with the app build, Android version and your phone’s region setting. Names of features and numbers only: no photos, no text you write, no places, no people. Kept with your Lens account ID so we can count returning users, never sold or shared, and deleted with your account', 'To learn which features help people, where they get stuck, and whether an update made Lens better', '13 months'],
          ],
        },
        p: ['We do not collect your contacts, call logs, SMS, or advertising identifiers, and we do not use third-party analytics in the app. The usage data Lens collects is its own (in the table above: diagnostics, crash reports and feature counts); it stays with us and is never sold or shared. Google’s on-device ML Kit (document scanner, scene labels, face detection; part of Google Play services) sends Google its own usage and performance statistics, never your photos; and Firebase gives the app an installation ID to deliver notifications. If we change what we collect, we will update this policy first.'],
      },
      {
        h2: '2. Your own storage (Google Drive, OneDrive, Dropbox, Box, S3, WebDAV)',
        p: [
          'If you connect your own storage, your photos and videos are uploaded directly from your phone to that provider. You sign in to the provider on its own page. On the free plan, the access keys stay on your phone; our servers help exchange the sign-in code but do not keep the keys. We keep the name of the connected account (its email address, or the server and user name for S3/WebDAV) so you can see which storage is connected. We keep only small previews in Lens so your gallery is fast. Your provider’s own privacy policy applies to the files stored there.',
          'Move to my Google Drive: only if you start it in Settings → Storage, your phone gives our servers its Google Drive sign-in for that one move. It is stored encrypted, used only to copy your originals from Lens storage into the Lens folder of your Google Drive (Lens can only see files it created there), and deleted as soon as the move stops. Each copy is checked before the Lens copy is removed.',
          'Download everything: when you ask for it, we pack the originals in your Lens storage into ZIP files that only signed links you get can open. The files are deleted after 7 days.',
        ],
      },
      {
        h2: '3. Where your data is stored and who processes it',
        ul: [
          'Amazon Web Services (AWS), Mumbai region, India: storage of your photos, videos and account data, our servers, and sending sign-in emails. Data is encrypted at rest and in transit.',
          'Amazon CloudFront (part of AWS): delivers previews and files quickly. It may cache copies at locations outside India for a short time. Every link is signed and expires.',
          'Google: if you choose "Sign in with Google" or connect Google Drive; and Google Firebase Cloud Messaging delivers notifications to Android phones (the notification text, such as "quiet-tiger wants to share 3 photos", passes through Google; never your photos). Turn notifications off in Settings → Notifications.',
          'Sentry (Functional Software, Inc.), United States: receives crash reports (see the table above) to show us what went wrong; it doesn’t receive photos, videos or account details.',
          'Razorpay (Razorpay Software Private Limited), India: only if you pay (Lens Plus, or moving more than the free amount to Google Drive). It handles the payment, the UPI Autopay or card mandate and its own notices, and receives your email address; it never receives photos or videos.',
          'Microsoft, Dropbox, Box or your S3/WebDAV provider: only if you connect them.',
        ],
        p: ['We do not sell, rent or trade your personal data. We do not show ads. We do not use your photos or videos to train AI models. Processors act only on our instructions.'],
      },
      {
        h2: '4. Processing on your phone',
        p: ['Thumbnails, previews, looks, edits, Night mode and Portrait outlines are made on your phone. The Portrait person outline is made by an on-device model built into the app; your photo is not sent anywhere for it. Long videos may be converted to streaming copies on our servers when someone plays them on another device.'],
      },
      {
        h2: '5. Deleting things',
        ul: [
          'Trash: deleted items stay 30 days and can be restored.',
          'Archive: after Trash, items are kept for 1 year (recoverable), then permanently deleted.',
          '"Delete forever" removes the item and all its copies immediately.',
          'Deleting your account removes your library, account and sign-ins (see the Delete your account page). Deleted data can remain in encrypted backups for up to 35 days before it is overwritten.',
          'Server logs (errors and timings) are kept for 7 days.',
        ],
      },
      {
        h2: '6. Cookies on the website',
        p: ['The website uses only strictly necessary cookies. "__Host-lens" keeps you signed in. It is secure, HttpOnly (scripts cannot read it) and sent only to lens.instagrowapp.com. It lasts up to 30 days or until you log out. If you arrive through an invite or affiliate link, a second cookie, "__Host-lensref", remembers that link’s code for up to 30 days so the right person is credited if you sign up on the website. We use no advertising or tracking cookies. To see which pages help people, each page view and a few clicks (such as Get Lens) are counted by our own script, without cookies or any ID: we keep only daily totals per page and per source website (for example "google.com"), never anything about you. Your browser’s tab remembers only that the visit was already counted (session storage, cleared when you close the tab).'],
      },
      {
        h2: '7. Your rights',
        p: ['Under the DPDP Act you can:'],
        ul: [
          'Get a summary of the personal data we hold about you and how we process it',
          'Correct or update your data',
          'Erase your data (delete items, or your whole account)',
          'Withdraw consent at any time (this stops the related processing; for example, deleting your account stops backup)',
          'Nominate a person to exercise your rights if you die or become incapacitated',
          'Raise a grievance with us, and then with the Data Protection Board of India',
        ],
      },
      {
        h2: '8. Children',
        p: ['Lens is for people aged 18 and over. Under-18s may use Lens only with the verifiable consent of a parent or lawful guardian. If you believe a child has used Lens without consent, contact us and we will delete the data.'],
      },
      {
        h2: '9. Security',
        p: ['We use HTTPS everywhere, encryption at rest, checksums on every upload, signed expiring links, one-way hashed session secrets, and sign-in without passwords. No system is perfectly secure; if a breach affects your data, we will inform you and the Data Protection Board as the law requires.'],
      },
      {
        h2: '10. Contact and grievance officer',
        p: [`Questions or requests: use our contact form at ${C}. Grievance Officer: choose "Grievance" on the same form (${G}). We acknowledge grievances within 48 hours and respond within 30 days, usually much sooner.`],
      },
      {
        h2: '11. Changes',
        p: ['We will post changes here and update the date below. For significant changes we will notify you in the app before they take effect.'],
      },
    ],
  },
  hi: {
    title: 'प्राइवेसी पॉलिसी',
    description: 'Lens by InstaGrow ठीक-ठीक क्या इकट्ठा करता है, क्यों, कहाँ स्टोर होता है, कितने समय रखा जाता है, कौन प्रोसेस करता है, और आपके अधिकार।',
    h1: 'प्राइवेसी पॉलिसी',
    intro: `यह पॉलिसी बताती है कि ${LEGAL.operator} ("हम") Lens ऐप (Android और iPhone) और lens.instagrowapp.com पर निजी डेटा कैसे संभालता है। यह भारत के डिजिटल पर्सनल डेटा प्रोटेक्शन एक्ट, 2023 और उसके नियमों के अनुसार लिखी गई है। हम सिर्फ़ वही इकट्ठा करते हैं जो Lens चलाने के लिए ज़रूरी है। (यह अनुवाद है; अंग्रेज़ी और हिंदी में अंतर होने पर अंग्रेज़ी संस्करण मान्य होगा।)`,
    blocks: [
      {
        h2: '1. हम क्या इकट्ठा करते हैं और क्यों',
        table: {
          head: ['डेटा', 'क्यों ज़रूरी है', 'कितने समय रखते हैं'],
          rows: [
            ['एक रैंडम Lens नाम (जैसे "quiet-tiger-8703")', 'आपका अकाउंट पहचानने और शेयर करते समय दोस्तों को आपको ढूँढने देने के लिए', 'अकाउंट डिलीट करने तक'],
            ['आपका नाम, अगर आप जोड़ें (Settings → Your name; वैकल्पिक)', 'आपके Lens नाम के साथ उन लोगों को दिखता है जिनसे आप शेयर करते हैं, जो आपसे शेयर करते हैं, या जो आपका Lens कोड स्कैन करते हैं, ताकि वे आपको पहचान सकें। इसे कभी सर्च नहीं किया जा सकता और सिर्फ़ Lens नाम सर्च करने वाले अनजान लोगों को नहीं दिखता', 'जब तक आप इसे हटा न दें या अकाउंट डिलीट न करें'],
            ['आपका ईमेल (ईमेल या Google से साइन इन करने पर)', 'एक बार के कोड से साइन इन और नए डिवाइस पर आपका अकाउंट पहचानने के लिए', 'अकाउंट डिलीट करने तक'],
            ['आपकी Google अकाउंट ID (Google से साइन इन करने पर)', 'Google से साइन इन के लिए। Google आपका नाम और प्रोफ़ाइल फ़ोटो भी भेजता है: नाम हम सिर्फ़ Settings → Your name में सुझाने के लिए रखते हैं (जब तक आप वहाँ सेव न करें, किसी और को नहीं दिखता), फ़ोटो स्टोर नहीं करते', 'अकाउंट डिलीट करने तक'],
            ['आपकी बैकअप की गई फ़ोटो और वीडियो, और उनका मेटाडेटा (जैसे तारीख़, कैमरा मॉडल और, अगर कैमरे ने रिकॉर्ड की हो, लोकेशन)', 'आपकी लाइब्रेरी स्टोर करने, दिखाने, शेयर और स्ट्रीम करने के लिए, यही Lens का मूल काम है', 'जब तक आप उन्हें डिलीट न करें (नीचे ट्रैश और आर्काइव देखें) या अकाउंट'],
            ['थंबनेल, प्रीव्यू, एडिट सेटिंग, पोर्ट्रेट आउटलाइन और स्ट्रीमिंग कॉपी', 'ब्राउज़िंग तेज़ करने और हर डिवाइस पर आपके एडिट दिखाने के लिए', 'प्रीव्यू/एडिट: फ़ोटो जितने समय। स्ट्रीमिंग कॉपी: आख़िरी बार बनने के 90 दिन बाद तक'],
            ['आप किसके साथ शेयर करते हैं', 'शेयर की गई चीज़ें उन्हें दिखाने के लिए', 'जब तक आप या वे शेयर न हटाएँ'],
            ['आपके बनाए शेयर लिंक: कौन-सी चीज़ें, कौन खोल सकता है, कब खत्म होंगे, कितनी बार देखे गए और Lens में किसने खोले', 'ताकि जिनके पास Lens नहीं है वे आपकी भेजी चीज़ें देख सकें, और आप अपने लिंक देख और बंद कर सकें। लिंक में सिर्फ़ आपकी चुनी चीज़ें होती हैं, कभी पूरा एल्बम या लाइब्रेरी नहीं; लोकेशन हटा दी जाती है जब तक आप शामिल न करें', 'लिंक खत्म होने या बंद करने तक, फिर 30 दिन'],
            ['डिवाइस और ब्राउज़र के नाम (जैसे "Samsung SM-A546E", "Chrome on Windows") और साइन-इन समय', 'आपके साइन-इन डिवाइस की सूची दिखाने के लिए ताकि आप उन्हें साइन आउट कर सकें', 'उस डिवाइस को साइन आउट करने तक, या 90 दिन इस्तेमाल न होने तक'],
            ['आपके फ़ोन की ऐप ID का वन-वे हैश', 'दोबारा इंस्टॉल करने पर नया मुफ़्त स्टोरेज बनाने के बजाय वही गेस्ट स्टोरेज लौटाने के लिए (दुरुपयोग रोकना)', 'अकाउंट डिलीट करने तक'],
            ['IP एड्रेस', 'दुरुपयोग सीमित करने के लिए (एक घंटे तक नेटवर्क के हिसाब से रिक्वेस्ट गिनना)', 'लगभग 2 घंटे'],
            ['नोटिफ़िकेशन टोकन (Android): एक पता जो Google आपके फ़ोन पर इस ऐप को देता है ताकि हम आपको नोटिफ़िकेशन भेज सकें (शेयर, इनवाइट, स्टोरेज)। Google Firebase Cloud Messaging के ज़रिए भेजा जाता है', 'आपको उन चीज़ों की सूचना देने के लिए जो आपने माँगी हैं; कौन-सी चाहिए यह आप Settings → Notifications में चुनते हैं', 'जब तक आप उस फ़ोन पर साइन आउट नहीं करते, ऐप हटाते नहीं, या अकाउंट नहीं हटाते'],
            ['प्लेसेज़ (सिर्फ़ अगर आप "Save location" चालू करते हैं): सही जगह हर फ़ोटो फ़ाइल के अंदर सेव होती है (किसी भी कैमरे की तरह; यह आपकी बैकअप की गई ओरिजिनल फ़ाइलों में रहती है), और प्लेसेज़ व्यू के लिए हम इसे लगभग 100 मीटर तक गोल करके सबसे पास के शहर के साथ रखते हैं', 'आपकी अपनी फ़ोटो को जगह के हिसाब से दिखाने के लिए। जिनके साथ आप शेयर करते हैं उन्हें फ़ोटो बिना जगह के मिलती है, जब तक आप उसे शामिल करना न चुनें', 'जब तक आप फ़ोटो या अकाउंट नहीं हटाते'],
            ['नियरबाय (सिर्फ़ अगर आप "Visible to nearby Lens users" चालू करते हैं): एक रैंडम कोड जो हर कुछ मिनट में बदलता है, Lens खुला रहने तक आपके Wi-Fi पर बताया जाता है', 'ताकि उसी Wi-Fi पर जिन्होंने इसे चालू किया है वे आपको आपके Lens नाम से ढूँढ सकें। नेटवर्क पर सिर्फ़ कोड जाता है; उसे हम आपके Lens नाम में बदलते हैं, आपकी जगह कभी नहीं', 'हर कोड 15 मिनट में खत्म हो जाता है'],
            ['पीपल (ज़्यादातर देशों में अपने-आप चालू; EU, UK और US में सिर्फ़ आपके चालू करने पर): आपकी अपनी Lens फ़ोटो के चेहरों के ग्रुप और उनके लिए आपके दिए नाम', 'सिर्फ़ आपके फ़ोन पर बनते और रहते हैं, ताकि फ़ोटो व्यक्ति के हिसाब से दिखें। हमें कभी नहीं भेजे जाते, बैकअप में नहीं जाते; सिर्फ़ फ़ेस मॉडल डाउनलोड होता है', 'जब तक आप पीपल बंद नहीं करते, जिससे यह मिट जाता है (Lens हटाने पर भी मिट जाता है)'],
            ['शेयरिंग: आपने किसके साथ शेयर किया और किसने आपके साथ, हर शेयर की स्थिति (प्रतीक्षा में, स्वीकार, अस्वीकार, रद्द, वापस लिया, समाप्त) और जिन लोगों को आपने ब्लॉक किया', 'ताकि आप शेयर स्वीकार या अस्वीकार कर सकें, भेजा हुआ रद्द या वापस ले सकें, और अनचाहे शेयर रोक सकें', 'जब तक आप अकाउंट नहीं हटाते'],
            ['वेबसाइट पर QR साइन इन माँगने पर अनुमानित शहर (आपके IP से)', 'मंज़ूरी से पहले आपके फ़ोन पर "कौन माँग रहा है" दिखाने के लिए', 'ज़्यादा से ज़्यादा 2 मिनट'],
            ['हम जो साइन-इन कोड ईमेल करते हैं', 'यह जाँचने के लिए कि ईमेल आपका है', '10 मिनट; सिर्फ़ हैश के रूप में'],
            ['आपकी भेजी रिक्वेस्ट (जैसे "स्टोरेज प्रोवाइडर जोड़ें", या संपर्क फ़ॉर्म: नाम, ईमेल, संदेश, और स्पैम रोकने के लिए आपके IP पते और ब्राउज़र का वन-वे हैश)', 'जवाब देने और Lens बेहतर करने के लिए', '2 साल तक'],
            ['सिर्फ़ अगर आप "Back up my phone’s camera too" चालू करें (Android): Lens आपके फ़ोन के कैमरा फ़ोल्डर (DCIM) की फ़ोटो और वीडियो पढ़ता है, WhatsApp या स्क्रीनशॉट जैसे दूसरे फ़ोल्डर कभी नहीं, और नई फ़ोटो का बैकअप वैसे ही लेता है जैसे Lens में ली गई फ़ोटो का। बंद करने पर यह रुक जाता है; फ़ोन की सेटिंग्स में Android की फ़ोटो अनुमति भी हटाई जा सकती है', 'किसी भी कैमरा ऐप से ली गई फ़ोटो का बैकअप लेने के लिए', 'बैकअप की गई फ़ोटो और वीडियो जितना'],
            ['ऐप में भेजी गई प्रतिक्रिया (Settings → Feedback): रेटिंग, रिव्यू या संदेश, उसकी श्रेणी, ईमेल सिर्फ़ अगर आप जवाब चाहें, फ़ोन मॉडल व ऐप वर्ज़न सिर्फ़ अगर वह स्विच चालू रहे, और स्क्रीनशॉट सिर्फ़ अगर आप उन्हें जोड़ें (आपके फ़ोन पर लोकेशन जैसी फ़ोटो जानकारी हटाकर दोबारा सेव; सिर्फ़ Lens टीम देखती है)', 'आपकी प्रतिक्रिया पढ़ने, जवाब देने और Lens बेहतर करने के लिए', '2 साल तक, या जब तक आप अकाउंट नहीं हटाते'],
            ['क्वालिटी लैब (सिर्फ़ अगर आप Settings → Camera info → Quality Lab इस्तेमाल करते हैं): आपकी चुनी हुई टेस्ट फ़ोटो, आपके फ़ोन मॉडल के साथ', 'आपके तरह के फ़ोन पर फ़ोटो क्वालिटी की तुलना करने और सुधारने के लिए', 'जब तक आप अकाउंट नहीं हटाते'],
            ['इनवाइट: कौन-सा इनवाइट या एफ़िलिएट लिंक या कोड आपको लाया (Google Play इंस्टॉल रेफ़रर, वेबसाइट कुकी या आपके टाइप किए कोड से), और क्या आपका फ़ोन एम्युलेटर है', 'आपके दोस्त को स्टोरेज इनाम या एफ़िलिएट को कमीशन देने और नकली साइन-अप रोकने के लिए', 'अकाउंट डिलीट करने तक'],
            ['इनवाइट और एफ़िलिएट लिंक पर क्लिक: समय, ब्राउज़र का प्रकार और IP एड्रेस का वन-वे हैश', 'धोखाधड़ी की जाँच और इनवाइट करने वाले के आँकड़े (सिर्फ़ गिनती, कभी नहीं कि किसने क्लिक किया)', 'क्लिक 30 दिन; रोज़ की गिनती लिंक रहने तक'],
            ['सिर्फ़ एफ़िलिएट: नाम, चैनल, PAN और UPI ID (एन्क्रिप्टेड), कमीशन और भुगतान', 'प्रोग्राम चलाने, आपको भुगतान करने और टैक्स क़ानून (TDS, Form 16A) के पालन के लिए', 'वित्त वर्ष के 8 साल बाद तक (भारतीय टैक्स और अकाउंटिंग क़ानून)'],
            ['इनाम, कमीशन और भुगतान में हर बदलाव का रिकॉर्ड', 'न बदला जा सकने वाला ऑडिट रिकॉर्ड, ताकि इनाम और भुगतान जाँचे जा सकें', '8 साल'],
            ['Lens Plus और दूसरे भुगतान: आपने कौन-सा प्लान चुना, Razorpay की सब्सक्रिप्शन और पेमेंट ID, राशि, तारीख़ें और स्थिति (चालू, रद्द, भुगतान फ़ेल); अतिरिक्त स्टोरेज में आपकी चुनी सीमा और प्लान से ऊपर का रोज़ का स्टोरेज। भुगतान Razorpay के अपने पेज पर होता है: आपके कार्ड, UPI या बैंक की जानकारी Razorpay के पास जाती है, हमारे पास कभी नहीं', 'आपका ख़रीदा स्टोरेज देने, शुल्क से पहले याद दिलाने, और टैक्स व हिसाब के रिकॉर्ड रखने के लिए', 'वित्त वर्ष के बाद 8 साल (भारतीय टैक्स और अकाउंटिंग क़ानून)'],
            ['गुमनाम कैमरा डायग्नोस्टिक्स (Android): फ़ोन मॉडल और Android वर्शन, ऐप बिल्ड, कैमरा कैसे शुरू हुआ (फ़ोटो और प्रीव्यू साइज़, इस्तेमाल हुए कैमरा फ़ीचर, एरर), और हर ऐप वर्शन में एक बार और महीने में एक बार यह सूची कि फ़ोन और उसके कैमरे क्या-क्या सपोर्ट करते हैं (मेमोरी, चिप, लेंस, रेज़ोल्यूशन, फ़्रेम रेट, वीडियो और फ़ोटो फ़ीचर), एक रैंडम ID के साथ जो हर महीने बदलती है ताकि हम रिपोर्ट नहीं, फ़ोन गिन सकें। कोई फ़ोटो नहीं, कोई लोकेशन नहीं, आपके अकाउंट या पिछले महीनों से जुड़ा नहीं। इसे आप Settings → Camera → Help improve Lens में बंद कर सकते हैं', 'उन फ़ोन मॉडल पर कैमरा की समस्याएँ ढूँढने और ठीक करने के लिए जिन्हें हम ख़ुद टेस्ट नहीं कर सकते, और हर तरह के फ़ोन के लिए सबसे अच्छी कैमरा सेटिंग चुनने के लिए', '1 साल'],
            ['क्रैश रिपोर्ट (Android): जब Lens क्रैश हो, अटक जाए या कोई एरर आए, तो एक रिपोर्ट कि कोड में यह कहाँ हुआ, ऐप बिल्ड, फ़ोन मॉडल और Android वर्शन, और उससे ठीक पहले Lens में क्या किया गया (कौन-सी स्क्रीन, कौन-सा बटन)। कोई फ़ोटो नहीं, कोई लोकेशन नहीं, कोई स्क्रीनशॉट नहीं, कोई IP पता नहीं, आपके नाम या ईमेल से जुड़ा नहीं। Sentry के ज़रिए भेजी जाती है। Settings → Camera → Help improve Lens बंद करने पर यह भी बंद', 'क्रैश और एरर ढूँढने और ठीक करने के लिए', '30 दिन'],
            ['Lens का इस्तेमाल कैसे होता है: जिन दिनों आप Lens इस्तेमाल करते हैं (हर दिन का एक रिकॉर्ड), और जब तक Settings → Camera → Help improve Lens चालू है, उस दिन ऐप के फ़ीचर कितनी बार इस्तेमाल हुए (जैसे "ली गई फ़ोटो: 12", "एडिटर खोला: 2"), ऐप बिल्ड, Android वर्शन और फ़ोन की क्षेत्र सेटिंग के साथ। सिर्फ़ फ़ीचर के नाम और संख्याएँ: कोई फ़ोटो नहीं, आपका लिखा कुछ नहीं, कोई जगह नहीं, कोई व्यक्ति नहीं। आपके Lens अकाउंट ID के साथ रखा जाता है ताकि हम लौटने वाले लोगों को गिन सकें, कभी बेचा या साझा नहीं किया जाता, और अकाउंट हटाने पर हट जाता है', 'यह समझने के लिए कि कौन-से फ़ीचर लोगों की मदद करते हैं, लोग कहाँ अटकते हैं, और कोई अपडेट Lens को बेहतर बना या नहीं', '13 महीने'],
          ],
        },
        p: ['हम आपके कॉन्टैक्ट, कॉल लॉग, SMS या विज्ञापन ID इकट्ठा नहीं करते, और ऐप में किसी थर्ड-पार्टी एनालिटिक्स का इस्तेमाल नहीं करते। Lens जो इस्तेमाल का डेटा इकट्ठा करता है वह उसका अपना है (ऊपर टेबल में: डायग्नोस्टिक्स, क्रैश रिपोर्ट और फ़ीचर गिनती); यह हमारे पास रहता है और कभी बेचा या साझा नहीं किया जाता। Google का ऑन-डिवाइस ML Kit (डॉक्यूमेंट स्कैनर, सीन लेबल, चेहरा पहचान; Google Play सर्विसेज़ का हिस्सा) Google को अपने इस्तेमाल और परफ़ॉर्मेंस के आँकड़े भेजता है, आपकी फ़ोटो कभी नहीं; और Firebase नोटिफ़िकेशन पहुँचाने के लिए ऐप को एक इंस्टॉलेशन ID देता है। हम जो इकट्ठा करते हैं उसमें बदलाव से पहले यह पॉलिसी अपडेट करेंगे।'],
      },
      {
        h2: '2. आपका अपना स्टोरेज (Google Drive, OneDrive, Dropbox, Box, S3, WebDAV)',
        p: ['अगर आप अपना स्टोरेज जोड़ते हैं, तो फ़ोटो और वीडियो सीधे आपके फ़ोन से उस प्रोवाइडर पर अपलोड होते हैं। आप प्रोवाइडर के अपने पेज पर साइन इन करते हैं। फ़्री प्लान में एक्सेस कीज़ आपके फ़ोन पर रहती हैं; हमारे सर्वर साइन-इन कोड बदलने में मदद करते हैं पर कीज़ नहीं रखते। जुड़े हुए अकाउंट का नाम (उसका ईमेल, या S3/WebDAV के लिए सर्वर और यूज़र नेम) हम रखते हैं ताकि आप देख सकें कौन-सा स्टोरेज जुड़ा है। गैलरी तेज़ रखने के लिए हम Lens में सिर्फ़ छोटे प्रीव्यू रखते हैं। वहाँ रखी फ़ाइलों पर प्रोवाइडर की अपनी प्राइवेसी पॉलिसी लागू होती है।', 'मेरे Google Drive में ले जाएँ: सिर्फ़ अगर आप Settings → Storage में इसे शुरू करते हैं, आपका फ़ोन उसी एक बार के लिए अपना Google Drive साइन-इन हमारे सर्वर को देता है। यह एन्क्रिप्ट करके रखा जाता है, सिर्फ़ आपके ओरिजिनल Lens स्टोरेज से आपके Google Drive के Lens फ़ोल्डर में कॉपी करने के लिए इस्तेमाल होता है (Lens वहाँ सिर्फ़ अपनी बनाई फ़ाइलें देख सकता है), और काम रुकते ही मिटा दिया जाता है। Lens की कॉपी हटाने से पहले हर कॉपी जाँची जाती है।', 'सब कुछ डाउनलोड करें: जब आप माँगते हैं, हम आपके Lens स्टोरेज के ओरिजिनल ZIP फ़ाइलों में पैक करते हैं, जिन्हें सिर्फ़ आपको मिले साइन किए हुए लिंक खोल सकते हैं। फ़ाइलें 7 दिन बाद मिटा दी जाती हैं।'],
      },
      {
        h2: '3. आपका डेटा कहाँ स्टोर होता है और कौन प्रोसेस करता है',
        ul: [
          'Amazon Web Services (AWS), मुंबई रीजन, भारत: आपकी फ़ोटो, वीडियो और अकाउंट डेटा का स्टोरेज, हमारे सर्वर, और साइन-इन ईमेल भेजना। डेटा स्टोरेज और ट्रांसफ़र दोनों में एन्क्रिप्टेड रहता है।',
          'Amazon CloudFront (AWS का हिस्सा): प्रीव्यू और फ़ाइलें तेज़ी से पहुँचाता है। यह थोड़े समय के लिए भारत के बाहर की जगहों पर कॉपी कैश कर सकता है। हर लिंक साइन किया हुआ है और एक्सपायर होता है।',
          'Google: अगर आप "Google से साइन इन" चुनते हैं या Google Drive जोड़ते हैं; और Google Firebase Cloud Messaging Android फ़ोन पर नोटिफ़िकेशन पहुँचाता है (नोटिफ़िकेशन का टेक्स्ट, जैसे "quiet-tiger 3 फ़ोटो शेयर करना चाहता है", Google से होकर जाता है; आपकी फ़ोटो कभी नहीं)। नोटिफ़िकेशन Settings → Notifications में बंद करें।',
          'Sentry (Functional Software, Inc.), अमेरिका: क्रैश रिपोर्ट पाता है (ऊपर टेबल देखें) ताकि हमें पता चले क्या गड़बड़ हुई; फ़ोटो, वीडियो या अकाउंट की जानकारी नहीं।',
          'Razorpay (Razorpay Software Private Limited), भारत: सिर्फ़ अगर आप भुगतान करते हैं (Lens Plus, या मुफ़्त सीमा से ज़्यादा Google Drive में ले जाना)। यह भुगतान, UPI Autopay या कार्ड मैंडेट और अपनी सूचनाएँ संभालता है, और आपका ईमेल पाता है; फ़ोटो या वीडियो कभी नहीं।',
          'Microsoft, Dropbox, Box या आपका S3/WebDAV प्रोवाइडर: सिर्फ़ अगर आप उन्हें जोड़ते हैं।',
        ],
        p: ['हम आपका निजी डेटा बेचते, किराए पर या बदले में नहीं देते। हम विज्ञापन नहीं दिखाते। हम आपकी फ़ोटो या वीडियो से AI मॉडल ट्रेन नहीं करते। प्रोसेसर सिर्फ़ हमारे निर्देश पर काम करते हैं।'],
      },
      {
        h2: '4. आपके फ़ोन पर प्रोसेसिंग',
        p: ['थंबनेल, प्रीव्यू, लुक्स, एडिट, नाइट मोड और पोर्ट्रेट आउटलाइन आपके फ़ोन पर बनते हैं। पोर्ट्रेट में व्यक्ति की आउटलाइन ऐप में मौजूद ऑन-डिवाइस मॉडल बनाता है; इसके लिए आपकी फ़ोटो कहीं नहीं भेजी जाती। लंबे वीडियो किसी दूसरे डिवाइस पर चलाए जाने पर हमारे सर्वर पर स्ट्रीमिंग कॉपी में बदले जा सकते हैं।'],
      },
      {
        h2: '5. चीज़ें डिलीट करना',
        ul: [
          'ट्रैश: डिलीट की गई चीज़ें 30 दिन रहती हैं और वापस लाई जा सकती हैं।',
          'आर्काइव: ट्रैश के बाद 1 साल रखी जाती हैं (वापस मिल सकती हैं), फिर हमेशा के लिए डिलीट।',
          '"हमेशा के लिए डिलीट" चीज़ और उसकी सभी कॉपी तुरंत हटा देता है।',
          'अकाउंट डिलीट करने पर आपकी लाइब्रेरी, अकाउंट और साइन-इन हट जाते हैं ("अकाउंट डिलीट करें" पेज देखें)। डिलीट किया गया डेटा ओवरराइट होने से पहले 35 दिन तक एन्क्रिप्टेड बैकअप में रह सकता है।',
          'सर्वर लॉग (एरर और समय) 7 दिन रखे जाते हैं।',
        ],
      },
      {
        h2: '6. वेबसाइट पर कुकी',
        p: ['वेबसाइट सिर्फ़ ज़रूरी कुकी इस्तेमाल करती है। "__Host-lens" आपको साइन इन रखती है। यह सुरक्षित, HttpOnly (स्क्रिप्ट नहीं पढ़ सकतीं) है और सिर्फ़ lens.instagrowapp.com को भेजी जाती है। यह 30 दिन तक या लॉग आउट करने तक रहती है। अगर आप किसी इनवाइट या एफ़िलिएट लिंक से आते हैं, तो दूसरी कुकी "__Host-lensref" उस लिंक का कोड 30 दिन तक याद रखती है ताकि वेबसाइट पर साइन अप करने पर सही व्यक्ति को श्रेय मिले। हम कोई विज्ञापन या ट्रैकिंग कुकी इस्तेमाल नहीं करते। यह देखने के लिए कि कौन-से पेज लोगों की मदद करते हैं, हर पेज व्यू और कुछ क्लिक (जैसे Get Lens) हमारी अपनी स्क्रिप्ट गिनती है, बिना कुकी या किसी ID के: हम सिर्फ़ हर पेज और हर स्रोत वेबसाइट (जैसे "google.com") के रोज़ाना कुल आँकड़े रखते हैं, आपके बारे में कुछ नहीं। ब्राउज़र का टैब सिर्फ़ यह याद रखता है कि विज़िट गिन ली गई (सेशन स्टोरेज, टैब बंद करने पर मिट जाता है)।'],
      },
      {
        h2: '7. आपके अधिकार',
        p: ['DPDP एक्ट के तहत आप:'],
        ul: [
          'हमारे पास आपके निजी डेटा और उसकी प्रोसेसिंग का सारांश पा सकते हैं',
          'अपना डेटा सुधार या अपडेट कर सकते हैं',
          'अपना डेटा मिटा सकते हैं (चीज़ें डिलीट करें, या पूरा अकाउंट)',
          'कभी भी सहमति वापस ले सकते हैं (इससे जुड़ी प्रोसेसिंग रुक जाती है; जैसे अकाउंट डिलीट करने से बैकअप रुकता है)',
          'आपकी मृत्यु या असमर्थता की स्थिति में अधिकारों के लिए किसी को नॉमिनेट कर सकते हैं',
          'हमसे शिकायत कर सकते हैं, और फिर डेटा प्रोटेक्शन बोर्ड ऑफ़ इंडिया से',
        ],
      },
      {
        h2: '8. बच्चे',
        p: ['Lens 18 साल और उससे ज़्यादा उम्र के लोगों के लिए है। 18 से कम उम्र के लोग माता-पिता या क़ानूनी अभिभावक की प्रमाणित सहमति से ही Lens इस्तेमाल कर सकते हैं। अगर आपको लगता है कि किसी बच्चे ने बिना सहमति Lens इस्तेमाल किया है, तो हमसे संपर्क करें और हम डेटा डिलीट कर देंगे।'],
      },
      {
        h2: '9. सुरक्षा',
        p: ['हम हर जगह HTTPS, स्टोरेज में एन्क्रिप्शन, हर अपलोड पर चेकसम, साइन किए हुए एक्सपायर होने वाले लिंक, वन-वे हैश किए सेशन सीक्रेट और बिना पासवर्ड साइन इन इस्तेमाल करते हैं। कोई सिस्टम पूरी तरह सुरक्षित नहीं होता; अगर किसी सेंधमारी से आपका डेटा प्रभावित होता है, तो हम क़ानून के अनुसार आपको और डेटा प्रोटेक्शन बोर्ड को बताएँगे।'],
      },
      {
        h2: '10. संपर्क और शिकायत अधिकारी',
        p: [`सवाल या रिक्वेस्ट: हमारे संपर्क फ़ॉर्म ${C} का इस्तेमाल करें। शिकायत अधिकारी: उसी फ़ॉर्म पर "शिकायत" चुनें (${G})। हम शिकायत 48 घंटे में स्वीकार करते हैं और 30 दिनों के अंदर जवाब देते हैं, आमतौर पर बहुत जल्दी।`],
      },
      {
        h2: '11. बदलाव',
        p: ['हम बदलाव यहाँ पोस्ट करेंगे और नीचे की तारीख़ अपडेट करेंगे। बड़े बदलावों के लिए लागू होने से पहले ऐप में बताएँगे।'],
      },
    ],
  },
};

export const terms: Record<Lang, LegalDoc> = {
  en: {
    title: 'Terms of service',
    description: 'The terms for using the Lens app and website: your content, acceptable use, storage limits, and our responsibilities.',
    h1: 'Terms of service',
    intro: `These terms are an agreement between you and ${LEGAL.operator} for using the Lens app and lens.instagrowapp.com ("Lens"). By using Lens you agree to them.`,
    blocks: [
      { h2: '1. Your content stays yours', p: ['You keep all rights to the photos and videos you store in Lens. You give us only the permission needed to run Lens for you: to store, copy (for backups, previews and streaming), and show or share your content where you ask us to.'] },
      { h2: '2. Your account', p: ['Keep access to your email and phone secure; anyone with access to them could sign in. You are responsible for activity on your account. You must be 18 or older, or have a parent or guardian’s consent.'] },
      {
        h2: '3. Acceptable use',
        p: ['Don’t use Lens to store or share content that is illegal, including child sexual abuse material, content that infringes others’ rights, or malware. Don’t send people content that harasses, threatens or sexually exploits anyone, or intimate images of someone without their consent. To report a photo, a link or a person, tap Report on what was shared with you, or use the contact form (topic “Report”); we review every report. Don’t try to break, overload or get around the limits and security of Lens. We may remove such content, report it to authorities where required by law, and suspend accounts.'],
      },
      { h2: '4. Storage limits', p: ['The free plan includes 5 GB of Lens storage before you sign in. After you sign in it includes 40 GB for your first 3 months (the welcome period), then 10 GB, plus any bonus storage from invites. When the welcome period ends, uploads continue for 14 more days. When you are above your limit, your content stays viewable, downloadable and shareable, and only new uploads to Lens storage pause. We remind you before the welcome period ends and at least once a month while you are above the limit. If you stay above your limit for 5 months in a row, we delete the content above it, starting with items in your Trash and then your most recent uploads, until you are within the limit. We notify you 90, 30, 7 and 1 days before, by notification and email, so you can get more storage, invite friends, move content to your own storage or download it. Getting back within the limit at any time stops this. Storage in your own connected services is governed by those services.', 'Paid plans: a paid plan gives its storage for the period paid. If a renewal payment fails, the plan keeps working for a 7-day grace period while the payment is retried, and we remind you. After that, or when a cancelled plan reaches the end of its paid period, your account returns to the free plan with the rules above; nothing is deleted then. Paying again restores the plan immediately, with no charge for the time in between.', 'Lens Plus through Razorpay (website and the app from our website): you can set up a UPI Autopay or card mandate during your welcome period without being charged; the subscription then starts when the welcome period ends, at the price shown when you set it up (₹59 a month or ₹499 a year, GST included). Razorpay notifies you before each charge and we remind you 3 days before the first one. You can cancel in one tap in the app or on the website at any time: before the first charge nothing is charged; after it, the plan runs to the end of the period paid for. Payments are not refunded for partial periods, except where the law requires.', 'Extra storage (optional, monthly Lens Plus through Razorpay): you can allow storage above your plan up to a limit you choose (10, 20, 50 or 100 GB). You pay ₹3 per GB per month (GST included) only for what you keep above your plan, measured once a day, so the most you can be charged in a month is your limit × ₹3. We tell you the exact amount 3 days before it is added to your next Lens Plus payment, and alert you at 50%, 80% and 100% of your limit. At your limit, new uploads pause; nothing is deleted or locked because of a bill. You can raise the limit at any time, and lower it or turn it off once you keep less than the new limit above your plan. If Lens Plus ends, extra storage switches off and any amount not yet added to a payment is not charged.', 'Moving your originals to your own Google Drive: the first 10 GB per account are free; above that, Lens charges the price per GB shown before you start (it covers the internet transfer), paid once. Paid space not used by a move stays available for your next move. Downloading a copy of everything in Lens storage is free (once a week).'] },
      {
        h2: '4a. Invite friends (bonus storage)',
        p: ['You get bonus Lens storage (currently +10 GB, for up to 10 friends) for each friend who installs Lens from your link or code, signs in on their own phone and backs up their photos. The friend currently gets one extra month of the welcome period. Each person and each phone can earn a reward only once; your own accounts, phones and emulators do not count, and unusual activity may be held for review. Bonus storage lasts as long as your account. If a reward was earned by fake accounts or other abuse we may remove it (nothing you stored is deleted; new uploads just pause if you are over the limit). The affiliate program has its own affiliate terms.'],
      },
      { h2: '5. Availability and backups', p: ['We work hard to keep Lens available and your files safe, with verified uploads and redundant storage. But no service can promise zero downtime or zero data loss; keep important originals in more than one place.'] },
      { h2: '6. Changes and ending the service', p: ['We may change features. If we ever end a service that stores your files, we will give at least 60 days’ notice so you can download your library. You can stop using Lens and delete your account at any time.'] },
      { h2: '7. Liability', p: ['To the extent the law allows, Lens is provided "as is" and our total liability for any claim is limited to the amount you paid us in the 12 months before it (₹0 on the free plan). Nothing here limits rights you have that cannot be limited by law.'] },
      { h2: '8. Law and disputes', p: ['These terms are governed by the laws of India. Contact us first so we can try to resolve any problem.'] },
      { h2: '9. Contact', p: [`Contact form: ${C}`] },
    ],
  },
  hi: {
    title: 'सेवा की शर्तें',
    description: 'Lens ऐप और वेबसाइट इस्तेमाल करने की शर्तें: आपका कंटेंट, सही इस्तेमाल, स्टोरेज सीमा और हमारी ज़िम्मेदारियाँ।',
    h1: 'सेवा की शर्तें',
    intro: `ये शर्तें Lens ऐप और lens.instagrowapp.com ("Lens") इस्तेमाल करने के लिए आपके और ${LEGAL.operator} के बीच एक समझौता हैं। Lens इस्तेमाल करके आप इन्हें मानते हैं। (यह अनुवाद है; अंतर होने पर अंग्रेज़ी संस्करण मान्य होगा।)`,
    blocks: [
      { h2: '1. आपका कंटेंट आपका ही रहता है', p: ['Lens में रखी फ़ोटो और वीडियो के सारे अधिकार आपके पास रहते हैं। आप हमें सिर्फ़ वही अनुमति देते हैं जो आपके लिए Lens चलाने के लिए ज़रूरी है: स्टोर करना, कॉपी करना (बैकअप, प्रीव्यू और स्ट्रीमिंग के लिए), और जहाँ आप कहें वहाँ दिखाना या शेयर करना।'] },
      { h2: '2. आपका अकाउंट', p: ['अपने ईमेल और फ़ोन की पहुँच सुरक्षित रखें; जिसके पास इनकी पहुँच है वह साइन इन कर सकता है। आपके अकाउंट पर होने वाली गतिविधि की ज़िम्मेदारी आपकी है। आपकी उम्र 18 साल या ज़्यादा होनी चाहिए, या माता-पिता/अभिभावक की सहमति।'] },
      { h2: '3. सही इस्तेमाल', p: ['Lens का इस्तेमाल ग़ैरक़ानूनी कंटेंट रखने या शेयर करने के लिए न करें, जिसमें बाल यौन शोषण सामग्री, दूसरों के अधिकारों का उल्लंघन करने वाला कंटेंट या मैलवेयर शामिल है। किसी को परेशान करने, धमकाने या किसी का यौन शोषण करने वाला कंटेंट, या किसी की सहमति के बिना उसकी निजी तस्वीरें न भेजें। किसी फ़ोटो, लिंक या व्यक्ति की रिपोर्ट करने के लिए, आपके साथ शेयर की गई चीज़ पर Report दबाएँ या संपर्क फ़ॉर्म (विषय “रिपोर्ट”) इस्तेमाल करें; हम हर रिपोर्ट की समीक्षा करते हैं। Lens की सीमाओं और सुरक्षा को तोड़ने, ओवरलोड करने या बायपास करने की कोशिश न करें। हम ऐसा कंटेंट हटा सकते हैं, क़ानून के अनुसार अधिकारियों को रिपोर्ट कर सकते हैं और अकाउंट निलंबित कर सकते हैं।'] },
      { h2: '4. स्टोरेज सीमा', p: ['फ़्री प्लान में साइन इन से पहले 5 GB Lens स्टोरेज शामिल है। साइन इन के बाद पहले 3 महीने (वेलकम अवधि) 40 GB, फिर 10 GB, साथ में इनवाइट से मिला बोनस स्टोरेज। वेलकम अवधि ख़त्म होने के बाद 14 दिन और अपलोड चलते रहते हैं। सीमा से ऊपर होने पर आपका कंटेंट देखा, डाउनलोड और शेयर किया जा सकता है, सिर्फ़ Lens स्टोरेज में नए अपलोड रुकते हैं। वेलकम अवधि ख़त्म होने से पहले और सीमा से ऊपर रहने तक कम से कम हर महीने हम याद दिलाते हैं। अगर आप लगातार 5 महीने सीमा से ऊपर रहते हैं, तो सीमा से ऊपर का कंटेंट डिलीट किया जाता है, पहले आपके ट्रैश के आइटम, फिर सबसे हाल के अपलोड, जब तक आप सीमा के अंदर न आ जाएँ। इससे 90, 30, 7 और 1 दिन पहले हम नोटिफ़िकेशन और ईमेल से बताते हैं, ताकि आप ज़्यादा स्टोरेज लें, दोस्तों को इनवाइट करें, कंटेंट अपने स्टोरेज में ले जाएँ या डाउनलोड करें। किसी भी समय सीमा के अंदर आने पर यह रुक जाता है। आपकी जोड़ी गई अपनी सेवाओं का स्टोरेज उन्हीं सेवाओं के नियमों से चलता है।', 'पेड प्लान: पेड प्लान भुगतान की अवधि तक अपना स्टोरेज देता है। रिन्यूअल का भुगतान फ़ेल होने पर प्लान 7 दिन की ग्रेस अवधि तक चलता रहता है, भुगतान दोबारा कोशिश किया जाता है और हम याद दिलाते हैं। उसके बाद, या रद्द किया गया प्लान अपनी भुगतान अवधि पूरी होने पर, आपका अकाउंट ऊपर के नियमों वाले फ़्री प्लान पर आ जाता है; तब कुछ भी डिलीट नहीं होता। दोबारा भुगतान करने पर प्लान तुरंत वापस आ जाता है, बीच के समय का कोई शुल्क नहीं।', 'Razorpay से Lens Plus (वेबसाइट और हमारी वेबसाइट वाला ऐप): वेलकम अवधि में आप बिना शुल्क के UPI Autopay या कार्ड मैंडेट सेट कर सकते हैं; सब्सक्रिप्शन वेलकम अवधि ख़त्म होने पर, सेट करते समय दिखाई गई कीमत पर शुरू होता है (₹59 हर महीने या ₹499 साल का, GST सहित)। हर शुल्क से पहले Razorpay सूचना देता है और पहले शुल्क से 3 दिन पहले हम याद दिलाते हैं। ऐप या वेबसाइट पर एक टैप में कभी भी रद्द करें: पहले शुल्क से पहले कुछ नहीं कटता; उसके बाद प्लान भुगतान की अवधि तक चलता है। अधूरी अवधि का पैसा वापस नहीं होता, जब तक क़ानून ऐसा न कहे।', 'अतिरिक्त स्टोरेज (वैकल्पिक, Razorpay से मासिक Lens Plus): आप अपने प्लान से ऊपर, अपनी चुनी सीमा (10, 20, 50 या 100 GB) तक स्टोरेज की अनुमति दे सकते हैं। प्लान से ऊपर जितना रखते हैं, सिर्फ़ उसके लिए ₹3 प्रति GB प्रति महीना (GST सहित) देते हैं, जो रोज़ एक बार मापा जाता है, इसलिए किसी महीने का अधिकतम शुल्क आपकी सीमा × ₹3 है। अगले Lens Plus भुगतान में जोड़ने से 3 दिन पहले हम सटीक राशि बताते हैं, और आपकी सीमा के 50%, 80% और 100% पर अलर्ट भेजते हैं। सीमा पर पहुँचने पर नए अपलोड रुकते हैं; बिल की वजह से कुछ भी डिलीट या लॉक नहीं होता। सीमा कभी भी बढ़ा सकते हैं, और प्लान से ऊपर नई सीमा से कम रखने पर घटा या बंद कर सकते हैं। Lens Plus ख़त्म होने पर अतिरिक्त स्टोरेज बंद हो जाता है और जो राशि किसी भुगतान में नहीं जुड़ी, वह नहीं ली जाती।', 'अपने ओरिजिनल अपने Google Drive में ले जाना: हर अकाउंट के पहले 10 GB मुफ़्त; उससे ऊपर, शुरू करने से पहले दिखाई गई प्रति GB कीमत (यह इंटरनेट ट्रांसफ़र का ख़र्च है), एक बार। किसी मूव में इस्तेमाल न हुई भुगतान की गई जगह अगली बार के लिए रहती है। Lens स्टोरेज की हर चीज़ की कॉपी डाउनलोड करना मुफ़्त है (हफ़्ते में एक बार)।'] },
      {
        h2: '4a. दोस्तों को इनवाइट करें (बोनस स्टोरेज)',
        p: ['हर उस दोस्त के लिए जो आपके लिंक या कोड से Lens इंस्टॉल करके अपने फ़ोन पर साइन इन करे और अपनी फ़ोटो का बैकअप ले, आपको बोनस Lens स्टोरेज (अभी +10 GB, 10 दोस्तों तक) मिलता है। दोस्त को अभी वेलकम अवधि का एक महीना ज़्यादा मिलता है। हर व्यक्ति और हर फ़ोन सिर्फ़ एक बार इनाम दिला सकता है; आपके अपने अकाउंट, फ़ोन और एम्युलेटर नहीं गिने जाते, और असामान्य गतिविधि जाँच के लिए रोकी जा सकती है। बोनस स्टोरेज आपके अकाउंट जितने समय रहता है। अगर इनाम नकली अकाउंट या दूसरे दुरुपयोग से मिला हो, तो हम उसे हटा सकते हैं (आपका रखा कुछ डिलीट नहीं होता; सीमा से ऊपर होने पर सिर्फ़ नए अपलोड रुकते हैं)। एफ़िलिएट प्रोग्राम की अपनी अलग शर्तें हैं।'],
      },
      { h2: '5. उपलब्धता और बैकअप', p: ['हम Lens को उपलब्ध और आपकी फ़ाइलें सुरक्षित रखने के लिए पूरी मेहनत करते हैं, जाँचे हुए अपलोड और कई जगह स्टोरेज के साथ। फिर भी कोई सेवा शून्य डाउनटाइम या शून्य डेटा हानि का वादा नहीं कर सकती; ज़रूरी ओरिजिनल एक से ज़्यादा जगह रखें।'] },
      { h2: '6. बदलाव और सेवा बंद होना', p: ['हम फ़ीचर बदल सकते हैं। अगर हम कभी फ़ाइलें स्टोर करने वाली सेवा बंद करते हैं, तो कम से कम 60 दिन पहले बताएँगे ताकि आप अपनी लाइब्रेरी डाउनलोड कर सकें। आप कभी भी Lens इस्तेमाल करना बंद करके अकाउंट डिलीट कर सकते हैं।'] },
      { h2: '7. ज़िम्मेदारी', p: ['क़ानून जितनी अनुमति देता है, Lens "जैसा है" वैसा दिया जाता है और किसी भी दावे के लिए हमारी कुल ज़िम्मेदारी उससे पहले के 12 महीनों में आपके दिए भुगतान तक सीमित है (फ़्री प्लान पर ₹0)। यहाँ कुछ भी आपके उन अधिकारों को सीमित नहीं करता जिन्हें क़ानून सीमित नहीं करने देता।'] },
      { h2: '8. क़ानून और विवाद', p: ['ये शर्तें भारत के क़ानूनों के अधीन हैं। किसी भी समस्या को सुलझाने के लिए पहले हमसे संपर्क करें।'] },
      { h2: '9. संपर्क', p: [`संपर्क फ़ॉर्म: ${C}`] },
    ],
  },
};

export const deletion: Record<Lang, LegalDoc> = {
  en: {
    title: 'Delete your Lens account',
    description: 'How to delete your Lens by InstaGrow account and exactly what is deleted, from the app, the website or the contact form.',
    h1: 'Delete your account',
    intro: 'You can delete your Lens by InstaGrow account and all its data at any time. Deleting is permanent: download anything you want to keep first.',
    blocks: [
      {
        h2: 'How to delete',
        ul: [
          'In the app: Settings → Account → Delete account, then confirm.',
          'On the website: sign in, open Account, choose Delete account, then confirm.',
          `By contact form: at ${C}, choose "Delete my account" and enter the email address on your account. We confirm by email and delete within 7 days.`,
        ],
      },
      {
        h2: 'What is deleted',
        ul: [
          'All photos and videos stored in Lens, with their previews, edits, streaming copies and recap films, and any Quality Lab test photos you sent',
          'Items in Trash and Archive',
          'Your shares (friends lose access to what you shared) and your Lens name',
          'Your email and Google sign-ins, devices and browser sessions',
          'Your storage connections (files already in your own Google Drive, OneDrive, Dropbox, Box, S3 or NAS stay there; they are yours)',
        ],
      },
      {
        h2: 'What is kept, and for how long',
        ul: [
          'Encrypted backups may hold deleted data for up to 35 days before being overwritten. It is not used or restored.',
          'Items friends shared with you belong to them and are not deleted with your account.',
          'Where the law requires us to keep a record (for example, a legal request), we keep only that record, for as long as required.',
        ],
      },
    ],
  },
  hi: {
    title: 'अपना Lens अकाउंट डिलीट करें',
    description: 'Lens by InstaGrow अकाउंट कैसे डिलीट करें और ठीक-ठीक क्या डिलीट होता है, ऐप, वेबसाइट या संपर्क फ़ॉर्म से।',
    h1: 'अकाउंट डिलीट करें',
    intro: 'आप कभी भी अपना Lens by InstaGrow अकाउंट और उसका सारा डेटा डिलीट कर सकते हैं। डिलीट करना स्थायी है: जो रखना है वह पहले डाउनलोड कर लें।',
    blocks: [
      {
        h2: 'कैसे डिलीट करें',
        ul: [
          'ऐप में: Settings → Account → Delete account, फिर पुष्टि करें।',
          'वेबसाइट पर: साइन इन करें, Account खोलें, Delete account चुनें, फिर पुष्टि करें।',
          `संपर्क फ़ॉर्म से: ${C} पर "मेरा अकाउंट डिलीट करें" चुनें और अपने अकाउंट वाला ईमेल डालें। हम ईमेल से पुष्टि करके 7 दिनों में डिलीट कर देंगे।`,
        ],
      },
      {
        h2: 'क्या डिलीट होता है',
        ul: [
          'Lens में रखी सारी फ़ोटो और वीडियो, उनके प्रीव्यू, एडिट, स्ट्रीमिंग कॉपी और रीकैप फ़िल्मों समेत, और आपकी भेजी कोई भी क्वालिटी लैब टेस्ट फ़ोटो',
          'ट्रैश और आर्काइव की चीज़ें',
          'आपके शेयर (दोस्तों को आपकी शेयर की गई चीज़ों तक पहुँच नहीं रहती) और आपका Lens नाम',
          'आपके ईमेल और Google साइन-इन, डिवाइस और ब्राउज़र सेशन',
          'आपके स्टोरेज कनेक्शन (आपके अपने Google Drive, OneDrive, Dropbox, Box, S3 या NAS में पहले से रखी फ़ाइलें वहीं रहती हैं; वे आपकी हैं)',
        ],
      },
      {
        h2: 'क्या रखा जाता है, और कितने समय',
        ul: [
          'एन्क्रिप्टेड बैकअप में डिलीट किया गया डेटा ओवरराइट होने से पहले 35 दिन तक रह सकता है। इसका इस्तेमाल या रिस्टोर नहीं होता।',
          'दोस्तों ने जो चीज़ें आपके साथ शेयर कीं वे उनकी हैं और आपके अकाउंट के साथ डिलीट नहीं होतीं।',
          'जहाँ क़ानून कोई रिकॉर्ड रखना ज़रूरी बनाता है (जैसे कोई क़ानूनी रिक्वेस्ट), हम सिर्फ़ वह रिकॉर्ड, ज़रूरत भर समय तक रखते हैं।',
        ],
      },
    ],
  },
};

export const affiliateTerms: Record<Lang, LegalDoc> = {
  en: {
    title: 'Affiliate program terms',
    description: 'The terms of the Lens affiliate program: 50% recurring commission on net revenue, the 30-day hold, monthly payouts, TDS, and fair-play rules.',
    h1: 'Affiliate program terms',
    intro: `These terms apply to the Lens affiliate program run by ${LEGAL.operator}, in addition to the Lens terms of service. By applying you agree to them. Version 9 October 2026.`,
    blocks: [
      { h2: '1. Joining', p: ['You need a Lens account and must be 18 or older. We review every application and may approve or decline it at our discretion. Your tracking links work only while your account is approved.'] },
      {
        h2: '2. Commission',
        ul: [
          'You earn 50% of net revenue from paid Lens plans bought by users you referred. Net revenue is what we actually receive: the price paid, minus GST and other taxes, minus the app store’s fee.',
          'Commission is recurring for as long as the referred user keeps paying, unless your account is ended under section 7.',
          'A user is referred by you if they installed Lens through your link (Google Play install referrer), signed up on the website after opening your link (within 30 days), or entered your code within 7 days of joining. Each user is credited to one referrer only, fixed at sign-up.',
          'We may change the commission rate for future payments with 30 days’ notice; payments already made keep the old rate.',
        ],
      },
      {
        h2: '3. Hold, refunds and reversals',
        p: ['Each commission is pending for 30 days after the payment, then approved. If the payment is refunded, charged back or cancelled during the hold, the commission is cancelled. If that happens after approval or payout, the amount is deducted from your next payouts.'],
      },
      {
        h2: '4. Payouts and tax',
        ul: [
          'Approved commission is paid monthly by UPI or bank transfer once your approved balance is at least ₹1,000; smaller balances roll over.',
          'Before your first payout you must give your PAN and payout details. They must match your name.',
          'We deduct TDS under section 194H of the Income-tax Act as required (currently 2% once your commission in a financial year exceeds ₹20,000, and 20% if no PAN is given) and issue Form 16A. You are responsible for your own income tax and GST, if applicable.',
          'Payments are made in Indian rupees to Indian accounts.',
        ],
      },
      {
        h2: '5. Not allowed',
        ul: [
          'Buying through your own link, or referring your own accounts or devices',
          'Fake, automated or incentivised installs or sign-ups (for example paying people to install), click fraud, or misleading claims about Lens',
          'Spam, including unsolicited messages, comments or emails',
          'Bidding on "Lens by InstaGrow" or similar brand terms in search ads, or pretending to be us',
          'Coupon or "free money" sites that misrepresent the program',
          'Content that is illegal, hateful, adult or violates platform rules',
        ],
        p: ['Commissions earned in breach of these rules are not payable and may be reversed.'],
      },
      { h2: '6. Disclosure', p: ['Clearly disclose that you are paid for referrals whenever you promote Lens (for example "#ad" or the platform’s paid-partnership label), as required by the ASCI guidelines for influencer advertising.'] },
      {
        h2: '7. Suspension and ending',
        p: ['We may suspend your account while we investigate unusual activity, and end it for breach of these terms. You may leave at any time. When your account ends without a breach, approved commissions are paid in the next payout run (even below the minimum) and no further commission accrues.'],
      },
      { h2: '8. Your data', p: ['We handle your application, PAN, payout details and earnings as described in the privacy policy. PAN and payout details are encrypted; tax and payment records are kept for 8 years as the law requires.'] },
      { h2: '9. Changes', p: ['We may update these terms with 30 days’ notice by email. Continuing after the change means you accept it.'] },
      { h2: '10. Contact', p: [`Contact form: ${C} (choose "Affiliate program")`] },
    ],
  },
  hi: {
    title: 'एफ़िलिएट प्रोग्राम की शर्तें',
    description: 'Lens एफ़िलिएट प्रोग्राम की शर्तें: नेट कमाई पर 50% रिकरिंग कमीशन, 30 दिन होल्ड, मासिक भुगतान, TDS और सही खेल के नियम।',
    h1: 'एफ़िलिएट प्रोग्राम की शर्तें',
    intro: `ये शर्तें ${LEGAL.operator} द्वारा चलाए जाने वाले Lens एफ़िलिएट प्रोग्राम पर, Lens की सेवा की शर्तों के अलावा, लागू होती हैं। आवेदन करके आप इन्हें मानते हैं। संस्करण 9 अक्टूबर 2026। (यह अनुवाद है; अंतर होने पर अंग्रेज़ी संस्करण मान्य होगा।)`,
    blocks: [
      { h2: '1. जुड़ना', p: ['आपके पास Lens अकाउंट होना चाहिए और उम्र 18 साल या ज़्यादा। हम हर आवेदन देखते हैं और अपने विवेक से मंज़ूर या अस्वीकार कर सकते हैं। आपके ट्रैकिंग लिंक तभी काम करते हैं जब आपका अकाउंट मंज़ूर हो।'] },
      {
        h2: '2. कमीशन',
        ul: [
          'आपके रेफ़र किए यूज़र जो पेड Lens प्लान ख़रीदते हैं, उनकी नेट कमाई का 50% आपको मिलता है। नेट कमाई वह है जो हमें असल में मिलती है: चुकाई गई कीमत, माइनस GST और दूसरे टैक्स, माइनस ऐप स्टोर की फ़ीस।',
          'जब तक रेफ़र किया गया यूज़र भुगतान करता रहे, कमीशन हर बार मिलता है, जब तक आपका अकाउंट धारा 7 के तहत ख़त्म न हो।',
          'यूज़र आपका रेफ़र किया माना जाता है अगर उसने आपके लिंक से Lens इंस्टॉल किया (Google Play इंस्टॉल रेफ़रर), आपका लिंक खोलने के 30 दिन के अंदर वेबसाइट पर साइन अप किया, या जुड़ने के 7 दिन के अंदर आपका कोड डाला। हर यूज़र सिर्फ़ एक रेफ़रर के नाम होता है, जो साइन-अप पर तय होता है।',
          'हम 30 दिन पहले बताकर आगे के भुगतानों की कमीशन दर बदल सकते हैं; पहले हो चुके भुगतानों पर पुरानी दर रहती है।',
        ],
      },
      { h2: '3. होल्ड, रिफ़ंड और वापसी', p: ['हर कमीशन भुगतान के बाद 30 दिन पेंडिंग रहता है, फिर मंज़ूर होता है। अगर इस दौरान भुगतान रिफ़ंड, चार्जबैक या रद्द हो, तो कमीशन रद्द हो जाता है। मंज़ूरी या भुगतान के बाद ऐसा हो, तो रक़म आपके अगले भुगतानों से काटी जाती है।'] },
      {
        h2: '4. भुगतान और टैक्स',
        ul: [
          'मंज़ूर कमीशन हर महीने UPI या बैंक ट्रांसफ़र से दिया जाता है, जब मंज़ूर बैलेंस कम से कम ₹1,000 हो; कम बैलेंस अगले महीने जुड़ता है।',
          'पहले भुगतान से पहले आपको PAN और भुगतान की जानकारी देनी होगी। ये आपके नाम से मेल खानी चाहिए।',
          'हम आयकर अधिनियम की धारा 194H के तहत ज़रूरी TDS काटते हैं (अभी वित्त वर्ष में कमीशन ₹20,000 से ज़्यादा होने पर 2%, और PAN न देने पर 20%) और Form 16A देते हैं। अपने इनकम टैक्स और, लागू हो तो, GST की ज़िम्मेदारी आपकी है।',
          'भुगतान भारतीय रुपये में भारतीय खातों में होते हैं।',
        ],
      },
      {
        h2: '5. मना है',
        ul: [
          'अपने ही लिंक से ख़रीदना, या अपने ही अकाउंट या डिवाइस रेफ़र करना',
          'नकली, ऑटोमेटेड या लालच देकर करवाए गए इंस्टॉल या साइन-अप (जैसे इंस्टॉल के लिए पैसे देना), क्लिक फ़्रॉड, या Lens के बारे में भ्रामक दावे',
          'स्पैम, जिसमें बिना माँगे मैसेज, कमेंट या ईमेल शामिल हैं',
          'सर्च विज्ञापनों में "Lens by InstaGrow" या मिलते-जुलते ब्रांड शब्दों पर बोली लगाना, या हमारे होने का दिखावा करना',
          'प्रोग्राम को ग़लत तरीके से दिखाने वाली कूपन या "फ़्री पैसे" वाली साइटें',
          'ग़ैरक़ानूनी, नफ़रत भरा, वयस्क या प्लेटफ़ॉर्म नियम तोड़ने वाला कंटेंट',
        ],
        p: ['इन नियमों को तोड़कर कमाया गया कमीशन देय नहीं है और वापस लिया जा सकता है।'],
      },
      { h2: '6. जानकारी देना', p: ['जब भी आप Lens का प्रचार करें, साफ़ बताएँ कि रेफ़रल के लिए आपको भुगतान मिलता है (जैसे "#ad" या प्लेटफ़ॉर्म का पेड-पार्टनरशिप लेबल), जैसा इन्फ़्लुएंसर विज्ञापन के लिए ASCI दिशानिर्देश कहते हैं।'] },
      { h2: '7. निलंबन और समाप्ति', p: ['असामान्य गतिविधि की जाँच के दौरान हम आपका अकाउंट निलंबित कर सकते हैं, और इन शर्तों के उल्लंघन पर ख़त्म कर सकते हैं। आप कभी भी छोड़ सकते हैं। बिना उल्लंघन के अकाउंट ख़त्म होने पर मंज़ूर कमीशन अगले भुगतान में दिया जाता है (न्यूनतम से कम हो तब भी) और आगे कमीशन नहीं जुड़ता।'] },
      { h2: '8. आपका डेटा', p: ['आपका आवेदन, PAN, भुगतान की जानकारी और कमाई हम प्राइवेसी पॉलिसी के अनुसार संभालते हैं। PAN और भुगतान की जानकारी एन्क्रिप्टेड रहती है; टैक्स और भुगतान के रिकॉर्ड क़ानून के अनुसार 8 साल रखे जाते हैं।'] },
      { h2: '9. बदलाव', p: ['हम 30 दिन पहले ईमेल से बताकर ये शर्तें बदल सकते हैं। बदलाव के बाद जारी रखने का मतलब है कि आप उन्हें मानते हैं।'] },
      { h2: '10. संपर्क', p: [`संपर्क फ़ॉर्म: ${C} ("एफ़िलिएट प्रोग्राम" चुनें)`] },
    ],
  },
};
