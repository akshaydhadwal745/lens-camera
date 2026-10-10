// Help centre: questions grouped by topic, English + Hindi. Every answer must
// match the app (labels as they appear in Settings) and docs/features/*.md.
import type { Lang } from '../i18n/ui';

export type HelpItem = { id: string; q: string; a: string; link?: [string, string] };
export type HelpTopic = { id: string; icon: string; title: string; blurb: string; items: HelpItem[] };

export const helpCopy: Record<
  Lang,
  {
    title: string;
    description: string;
    kicker: string;
    h1: string;
    lead: string;
    search: string;
    searchLabel: string;
    noResults: string;
    noResultsLink: string;
    topicsLabel: string;
    questions: (n: number) => string;
    stuckTitle: string;
    stuckText: string;
    stuckButton: string;
    stuckTip: string;
  }
> = {
  en: {
    title: 'Help: answers about Lens',
    description: 'How to install Lens, use the camera, back up photos and videos, free up phone space, use your own storage, recover deleted items and sign in on a computer.',
    kicker: 'Help',
    h1: 'How can we help?',
    lead: 'Answers about installing Lens, the camera, backup, storage and your account.',
    search: 'Search help',
    searchLabel: 'Search the help questions',
    noResults: 'Nothing matches that yet.',
    noResultsLink: 'Ask us directly',
    topicsLabel: 'Help topics',
    questions: (n) => `${n} questions`,
    stuckTitle: 'Still need help?',
    stuckText: 'Write to us and a person reads it. We reply by email, usually within two working days.',
    stuckButton: 'Contact us',
    stuckTip: 'Camera problem? In the app open Settings → Camera info → Run self-test and attach a screenshot. It tells us exactly what your phone supports.',
  },
  hi: {
    title: 'मदद: Lens से जुड़े जवाब',
    description: 'Lens इंस्टॉल करना, कैमरा इस्तेमाल करना, फ़ोटो और वीडियो का बैकअप, फ़ोन में जगह ख़ाली करना, अपना स्टोरेज, डिलीट की गई चीज़ें वापस पाना और कंप्यूटर पर साइन इन।',
    kicker: 'मदद',
    h1: 'हम कैसे मदद करें?',
    lead: 'Lens इंस्टॉल करने, कैमरा, बैकअप, स्टोरेज और आपके अकाउंट के बारे में जवाब।',
    search: 'मदद में खोजें',
    searchLabel: 'मदद के सवालों में खोजें',
    noResults: 'इससे मिलता कोई सवाल नहीं मिला।',
    noResultsLink: 'सीधे हमसे पूछें',
    topicsLabel: 'मदद के विषय',
    questions: (n) => `${n} सवाल`,
    stuckTitle: 'अब भी मदद चाहिए?',
    stuckText: 'हमें लिखें, आपका संदेश एक इंसान पढ़ता है। हम ईमेल से जवाब देते हैं, आमतौर पर दो कामकाजी दिनों में।',
    stuckButton: 'संपर्क करें',
    stuckTip: 'कैमरा में दिक़्क़त? ऐप में Settings → Camera info → Run self-test खोलें और उसका स्क्रीनशॉट भेजें। इससे हमें पता चलता है कि आपका फ़ोन ठीक-ठीक क्या सपोर्ट करता है।',
  },
};

export const helpTopics: Record<Lang, HelpTopic[]> = {
  en: [
    {
      id: 'start',
      icon: 'start',
      title: 'Getting started',
      blurb: 'Install, updates, guest or account',
      items: [
        { id: 'phones', q: 'Which phones does Lens work on?', a: 'Android phones running Android 7 or newer. An iPhone version is built and follows the Android launch. Your library also works in any browser at lens.instagrowapp.com.' },
        { id: 'install', q: 'How do I install Lens?', a: 'Open lens.instagrowapp.com/download on your phone and tap Download. When the file finishes, open it. If Android asks, allow your browser to install unknown apps, then tap Install. If Play Protect shows a warning, tap “More details” → “Install anyway”: Lens is new, so Google doesn’t know it yet.', link: ['Download page', 'download'] },
        { id: 'genuine', q: 'Is it safe to install Lens from the website?', a: 'Yes. Every Lens download is signed with our own key, and the download page shows the SHA-256 checksum of the current file so you can check it. Lens asks only for the camera, the microphone (for sound in videos) and notifications (to show backup progress).' },
        { id: 'not-installed', q: 'Installing says “App not installed”', a: 'You probably have an older test version of Lens. Uninstall it first, then install again. Photos that finished uploading are safe in your account: sign in again after installing and they’re all there.' },
        { id: 'updates', q: 'How do I update Lens?', a: 'Most updates arrive by themselves in the background: a small “New version ready · Tap to restart” pill appears, or the update is used the next time you open Lens. Bigger updates show “New Lens version · Download”: tap it and install the file over the current app. Your photos and settings stay.' },
        { id: 'account-needed', q: 'Do I need an account?', a: 'No. Lens works right away as a guest with 5 GB of backup. Sign in with your email or Google account any time to get 100 GB and to see your library on other phones and computers. Everything you took as a guest comes with you.' },
      ],
    },
    {
      id: 'camera',
      icon: 'camera',
      title: 'Camera',
      blurb: 'Night, PRO, flash, Portrait, looks',
      items: [
        { id: 'simple-pro', q: 'Where are the manual controls?', a: 'Lens starts in a simple camera that handles exposure, focus, white balance and HDR for you. Tap PRO at the top for manual ISO, shutter, white balance and focus, RAW, 4K and frame rate, video options, the grid and more. Lens remembers your PRO settings for the next time.' },
        { id: 'night', q: 'How do I take photos in the dark?', a: 'Just shoot. When it’s dark, a yellow Night badge appears and Lens takes several quick shots and merges them into one clean photo. Hold the phone still for about a second while it says “Hold still…”. Tap the badge to turn Night off. On phones whose maker has its own Night mode, Lens uses it.' },
        { id: 'flash', q: 'The flash didn’t fire', a: 'Check the flash button at the top: OFF never fires, AUTO fires only when it’s dark, ON always fires. Choosing AUTO or ON turns automatic Night off, because flash and Night can’t work together. On the front camera, Lens lights the screen white as a selfie flash.' },
        { id: 'portrait', q: 'How does Portrait mode work?', a: 'Choose PORTRAIT and frame a person. Lens finds them and blurs the background. The blur isn’t baked in: change it or turn it off later in the editor. If there’s no person in the shot, you get a normal photo.' },
        { id: 'looks', q: 'Where are the filters?', a: 'Open any photo or video and tap Edit. Pick one of 13 looks and set its strength, or adjust exposure, contrast, colour and more. The original file is never changed: every edit can be changed or removed later, on every device.' },
        { id: 'quality', q: 'Does Lens reduce quality?', a: 'No. Lens saves photos at your camera’s full resolution and backs up the exact file it saved. Nothing is compressed or re-encoded, and edits are stored separately. In PRO you can also shoot RAW and Ultra HDR on phones that support them.' },
        { id: 'camera-problem', q: 'Something looks wrong with the camera', a: 'Open Settings → Camera info → Run self-test. It tests rotation, focus, flash and full-resolution photos on your phone in about a minute. Send us a screenshot of the result with the contact form and we’ll look into it.', link: ['Contact form', 'contact'] },
      ],
    },
    {
      id: 'backup',
      icon: 'cloud',
      title: 'Backup & uploads',
      blurb: 'How backup works, waiting uploads',
      items: [
        { id: 'how-backup', q: 'How does backup work?', a: 'The moment you take a shot, Lens uploads a small preview, so it shows on your other devices within seconds. Then it uploads the full original and checks the stored copy against your phone’s file. Only a verified original counts as backed up.' },
        { id: 'still-uploading', q: 'Why is something still uploading?', a: 'Settings → Uploads shows what’s waiting and why. Usually it’s the mobile-data setting: by default files up to 100 MB upload on mobile data and bigger ones wait for Wi-Fi. Uploads also pause while you’re offline or while the phone is hot, and continue by themselves afterwards.' },
        { id: 'mobile-data', q: 'Can I stop Lens using mobile data?', a: 'Yes. Settings → Uploads → Upload over mobile data: Everything, Up to 100 MB, or Wi-Fi only. Small previews always upload so your library stays up to date; they use very little data.' },
        { id: 'background', q: 'Does backup continue when I close Lens?', a: 'Yes, on Android. While originals upload, a “Backing up 3 of 12” notification shows the progress. If the phone restarts or Android closes Lens, backup continues on its own a little later. Allow notifications when Lens asks so this can run.' },
        { id: 'video-while-recording', q: 'Do long videos take ages to upload?', a: 'Lens can upload a video while you’re still recording, so it’s almost all in the cloud when you press stop. Choose when in Settings → Uploads → Upload videos while recording: Wi-Fi only (default), Wi-Fi + mobile data, or Off.' },
        { id: 'icons', q: 'What do the little icons on photos mean?', a: 'Grey cloud with an arrow: waiting to upload. A percentage: uploading. Blue cloud with an arrow: visible everywhere, full original still uploading. Cloud with a tick: the original is safe in the cloud. Red “!”: the upload failed; tap the banner to try again.' },
        { id: 'import', q: 'Can I back up photos I already have?', a: 'Yes. In the gallery, tap the Import button and pick up to 100 photos and videos at a time. Lens backs them up one by one at full quality. The originals stay in your phone’s gallery; Lens never scans or uploads your gallery on its own.' },
      ],
    },
    {
      id: 'space',
      icon: 'phone',
      title: 'Phone space',
      blurb: 'Free up space, offline viewing',
      items: [
        { id: 'free-space', q: 'How does Lens free up space on my phone?', a: 'Once an original is safely in the cloud, Lens can remove the big file from your phone and keep a sharp preview. By default originals stay on the phone for 7 days, and Lens always keeps 2 GB free. Change both in Settings → On this device.' },
        { id: 'free-now', q: 'My phone is full right now', a: 'Open Settings → On this device and tap “Free up space now”. Every original that’s already safe in the cloud is removed from the phone straight away. Your gallery stays complete.' },
        { id: 'never-lost', q: 'Can Lens delete something that isn’t backed up?', a: 'No. Lens only removes a file from your phone after the cloud copy has been checked against it. Anything still waiting to upload is never touched.' },
        { id: 'offline', q: 'Can I see my photos without internet?', a: 'Yes. The gallery and previews are always on your phone and work offline. Full quality loads from the cloud when you open a photo: automatically on Wi-Fi, and on mobile data when you tap HD or zoom in.' },
      ],
    },
    {
      id: 'storage',
      icon: 'storage',
      title: 'Storage & plans',
      blurb: '100 GB free, your own storage',
      items: [
        { id: 'how-much', q: 'How much free storage do I get?', a: '5 GB as a guest and 100 GB when you sign in, at original quality. Every friend who joins with your invite adds another 10 GB, with no limit.', link: ['Pricing', 'pricing'] },
        { id: 'full', q: 'What happens when my storage is full?', a: 'Nothing is deleted. Guests are asked to sign in for 100 GB. If you’re signed in, invite friends for more space or connect your own storage. The storage pill at the bottom of the gallery shows how full you are.' },
        { id: 'own-storage', q: 'Can I use my own Google Drive, OneDrive or Dropbox?', a: 'Yes. Tap the storage pill in the gallery (or Settings → Storage), choose Google Drive, OneDrive, Dropbox, Box, an S3-compatible bucket or a WebDAV/NAS folder, and sign in. New originals then go only there, checked after every upload. If it fills up or signs out, Lens uses its own storage until you fix it.', link: ['Use your own storage', 'features/your-own-storage'] },
        { id: 'recent-saver', q: 'What are “Recent” and “Saver” in Storage?', a: 'Your newest 20 GB sit in Recent, the fastest tier. Older items move to Saver, which stores them more cheaply. Both open instantly at full quality; it only helps keep Lens free.' },
        { id: 'invite', q: 'How do invites work?', a: 'Settings → Invite & earn → Invite friends gives you a link. When a friend installs Lens and signs in on their phone, you get +10 GB. Each person and each phone counts once.' },
      ],
    },
    {
      id: 'delete',
      icon: 'trash',
      title: 'Delete & recover',
      blurb: 'Trash, Archive, shared items',
      items: [
        { id: 'mistake', q: 'I deleted something by mistake', a: 'Open Settings → Trash & Archive. Deleted items stay in the Trash for 30 days and come back instantly with Restore. After that they move to the Archive for a year, where Recover brings back the full original in about 12 hours.' },
        { id: 'not-uploaded', q: 'Can I recover something that never finished uploading?', a: 'Unfortunately not. Deleting removes it from the phone, and there’s no cloud copy to keep in the Trash. Lens warns you about this before it deletes.' },
        { id: 'shared-delete', q: 'What happens when I delete something I shared?', a: 'Lens asks you. “Delete for everyone” moves it to your Trash and your friends stop seeing it. “Only for me” removes it from your library while your friends keep it.' },
        { id: 'forever', q: 'How do I delete something forever?', a: 'In Settings → Trash & Archive, select it and tap “Delete forever”. Every copy is removed and it can’t be recovered.' },
      ],
    },
    {
      id: 'web',
      icon: 'laptop',
      title: 'Computer & sharing',
      blurb: 'Web app, QR sign-in, friends',
      items: [
        { id: 'computer', q: 'How do I use Lens on a computer?', a: 'Open lens.instagrowapp.com and click Sign in. Scan the QR code with Lens on your phone and tap Approve, or sign in with the same email or Google account. Your whole library opens in the browser and stays in sync by itself.', link: ['Sign in', 'signin'] },
        { id: 'upload-computer', q: 'Can I upload from my computer?', a: 'Yes. In the web app, click Upload or drag photos and videos onto the page. They upload at full quality and appear on your phone too.' },
        { id: 'web-quality', q: 'Why does a photo look smaller in the browser?', a: 'Browsers can’t open HEIC or RAW files, or apply Lens edits yet, so for those the web app shows a sharp 2048-pixel preview. “Open original” downloads the full file. Normal JPEG photos show at full quality.' },
        { id: 'sign-out-computer', q: 'How do I sign a computer out?', a: 'On the computer: Settings → Sign out of this browser. From your phone: Settings → Computers → Log out all computers, for example if you used a shared or lost computer.' },
        { id: 'friends', q: 'How do I send photos to friends?', a: 'Select photos or videos → Send to friends, then search for their Lens name or pick from Recent. They appear under Shared in your friend’s Lens. Items can be sent once their original has finished uploading.' },
        { id: 'share-out', q: 'How do I share to WhatsApp, Instagram or others?', a: 'Open the photo or video and tap Share, or Save to Photos to keep a copy in your phone’s gallery. If the original is only in the cloud, Lens downloads it first. Edits are included.' },
      ],
    },
    {
      id: 'account',
      icon: 'person',
      title: 'Account & privacy',
      blurb: 'Sign-in codes, new phone, deleting',
      items: [
        { id: 'new-phone', q: 'How do I get my photos on a new phone?', a: 'Install Lens and sign in with the same email or Google account. Your whole library appears: previews first, full originals when you open them. Nothing needs to be copied between phones.' },
        { id: 'code', q: 'My sign-in code didn’t arrive', a: 'Check your spam or promotions folder for an email from Lens. Codes last 10 minutes and you can ask for up to 5 an hour. Temporary or disposable email addresses aren’t accepted; use your normal email or Continue with Google.' },
        { id: 'log-out', q: 'How do I log out of the app?', a: 'Settings → Account → Log out. Lens only allows it once everything has uploaded, so nothing is lost. “Log out other devices” signs out every other phone at once.' },
        { id: 'privacy', q: 'Who can see my photos?', a: 'Only you, and the friends you send items to. Lens doesn’t sell your data, never looks at your photos and doesn’t use them to train AI. Files are encrypted on their way and while stored.', link: ['Privacy & security', 'security'] },
        { id: 'delete-account', q: 'How do I delete my account?', a: 'In Settings, tap “Delete account and data”, on your phone or on the website. Your sign-ins are revoked straight away, and all your photos, videos, shares and details are then permanently deleted.', link: ['What gets deleted', 'delete-account'] },
      ],
    },
  ],
  hi: [
    {
      id: 'start',
      icon: 'start',
      title: 'शुरुआत',
      blurb: 'इंस्टॉल, अपडेट, गेस्ट या अकाउंट',
      items: [
        { id: 'phones', q: 'Lens किन फ़ोन पर चलता है?', a: 'Android 7 या नए Android फ़ोन पर। iPhone वर्शन बना हुआ है और Android लॉन्च के बाद आएगा। आपकी लाइब्रेरी lens.instagrowapp.com पर किसी भी ब्राउज़र में भी चलती है।' },
        { id: 'install', q: 'Lens कैसे इंस्टॉल करें?', a: 'फ़ोन पर lens.instagrowapp.com/download खोलें और Download दबाएँ। फ़ाइल पूरी होने पर उसे खोलें। Android पूछे तो अपने ब्राउज़र को अनजान ऐप इंस्टॉल करने की इजाज़त दें, फिर Install दबाएँ। Play Protect चेतावनी दिखाए तो “More details” → “Install anyway” दबाएँ: Lens नया है, इसलिए Google उसे अभी नहीं जानता।', link: ['डाउनलोड पेज', 'download'] },
        { id: 'genuine', q: 'क्या वेबसाइट से Lens इंस्टॉल करना सुरक्षित है?', a: 'हाँ। हर Lens डाउनलोड हमारी अपनी की से साइन होता है, और डाउनलोड पेज पर मौजूदा फ़ाइल का SHA-256 चेकसम दिखता है ताकि आप जाँच सकें। Lens सिर्फ़ कैमरा, माइक्रोफ़ोन (वीडियो में आवाज़ के लिए) और नोटिफ़िकेशन (बैकअप की प्रोग्रेस दिखाने के लिए) की इजाज़त माँगता है।' },
        { id: 'not-installed', q: 'इंस्टॉल करने पर “App not installed” आता है', a: 'शायद आपके पास Lens का पुराना टेस्ट वर्शन है। पहले उसे अनइंस्टॉल करें, फिर दोबारा इंस्टॉल करें। जो फ़ोटो अपलोड हो चुकी हैं वे आपके अकाउंट में सुरक्षित हैं: इंस्टॉल के बाद फिर से साइन इन करें और सब वहीं मिलेंगी।' },
        { id: 'updates', q: 'Lens अपडेट कैसे करें?', a: 'ज़्यादातर अपडेट बैकग्राउंड में अपने-आप आते हैं: “New version ready · Tap to restart” दिखता है, या अगली बार Lens खोलने पर अपडेट लग जाता है। बड़े अपडेट पर “New Lens version · Download” दिखता है: उसे दबाएँ और फ़ाइल को मौजूदा ऐप के ऊपर इंस्टॉल करें। आपकी फ़ोटो और सेटिंग वैसी ही रहती हैं।' },
        { id: 'account-needed', q: 'क्या अकाउंट ज़रूरी है?', a: 'नहीं। Lens गेस्ट के तौर पर 5 GB बैकअप के साथ तुरंत चलता है। 100 GB पाने और दूसरे फ़ोन व कंप्यूटर पर अपनी लाइब्रेरी देखने के लिए कभी भी ईमेल या Google अकाउंट से साइन इन करें। गेस्ट के तौर पर ली गई हर चीज़ साथ आती है।' },
      ],
    },
    {
      id: 'camera',
      icon: 'camera',
      title: 'कैमरा',
      blurb: 'नाइट, PRO, फ़्लैश, पोर्ट्रेट, लुक',
      items: [
        { id: 'simple-pro', q: 'मैनुअल कंट्रोल कहाँ हैं?', a: 'Lens एक आसान कैमरा में खुलता है जो एक्सपोज़र, फ़ोकस, व्हाइट बैलेंस और HDR ख़ुद संभालता है। ऊपर PRO दबाएँ: मैनुअल ISO, शटर, व्हाइट बैलेंस और फ़ोकस, RAW, 4K और फ़्रेम रेट, वीडियो विकल्प, ग्रिड वग़ैरह। Lens आपकी PRO सेटिंग अगली बार के लिए याद रखता है।' },
        { id: 'night', q: 'अँधेरे में फ़ोटो कैसे लें?', a: 'बस फ़ोटो लें। अँधेरा होने पर पीला Night बैज दिखता है और Lens कुछ तेज़ शॉट लेकर उन्हें एक साफ़ फ़ोटो में जोड़ता है। “Hold still…” दिखने पर फ़ोन लगभग एक सेकंड स्थिर रखें। Night बंद करने के लिए बैज दबाएँ। जिन फ़ोन में कंपनी का अपना Night मोड है, वहाँ Lens उसी को इस्तेमाल करता है।' },
        { id: 'flash', q: 'फ़्लैश नहीं चला', a: 'ऊपर फ़्लैश बटन देखें: OFF पर कभी नहीं, AUTO पर सिर्फ़ अँधेरे में, ON पर हमेशा। AUTO या ON चुनने पर ऑटोमैटिक Night बंद हो जाता है, क्योंकि फ़्लैश और Night साथ नहीं चलते। फ़्रंट कैमरा पर Lens स्क्रीन को सफ़ेद करके सेल्फ़ी फ़्लैश देता है।' },
        { id: 'portrait', q: 'पोर्ट्रेट मोड कैसे काम करता है?', a: 'PORTRAIT चुनें और किसी व्यक्ति को फ़्रेम में लें। Lens उन्हें पहचानकर बैकग्राउंड धुंधला करता है। ब्लर फ़ोटो में पक्का नहीं होता: बाद में एडिटर में बदलें या बंद करें। फ़्रेम में कोई व्यक्ति न हो तो आम फ़ोटो मिलती है।' },
        { id: 'looks', q: 'फ़िल्टर कहाँ हैं?', a: 'कोई भी फ़ोटो या वीडियो खोलें और Edit दबाएँ। 13 लुक में से एक चुनें और उसकी ताक़त तय करें, या एक्सपोज़र, कंट्रास्ट, रंग वग़ैरह बदलें। ओरिजिनल फ़ाइल कभी नहीं बदलती: हर एडिट बाद में हर डिवाइस पर बदला या हटाया जा सकता है।' },
        { id: 'quality', q: 'क्या Lens क्वालिटी कम करता है?', a: 'नहीं। Lens फ़ोटो आपके कैमरा के पूरे रेज़ोल्यूशन में सेव करता है और ठीक वही फ़ाइल बैकअप करता है। कुछ भी कंप्रेस या दोबारा एन्कोड नहीं होता, और एडिट अलग रखे जाते हैं। PRO में, जिन फ़ोन में सपोर्ट है, RAW और Ultra HDR भी ले सकते हैं।' },
        { id: 'camera-problem', q: 'कैमरा में कुछ गड़बड़ लग रहा है', a: 'Settings → Camera info → Run self-test खोलें। यह लगभग एक मिनट में आपके फ़ोन पर रोटेशन, फ़ोकस, फ़्लैश और फ़ुल-रेज़ोल्यूशन फ़ोटो जाँचता है। नतीजे का स्क्रीनशॉट संपर्क फ़ॉर्म से भेजें, हम देखेंगे।', link: ['संपर्क फ़ॉर्म', 'contact'] },
      ],
    },
    {
      id: 'backup',
      icon: 'cloud',
      title: 'बैकअप और अपलोड',
      blurb: 'बैकअप कैसे होता है, रुके अपलोड',
      items: [
        { id: 'how-backup', q: 'बैकअप कैसे काम करता है?', a: 'फ़ोटो लेते ही Lens एक छोटा प्रीव्यू अपलोड करता है, ताकि वह कुछ सेकंड में आपके दूसरे डिवाइस पर दिखे। फिर पूरा ओरिजिनल अपलोड होता है और क्लाउड की कॉपी को फ़ोन की फ़ाइल से मिलाकर जाँचा जाता है। सिर्फ़ जाँचा हुआ ओरिजिनल ही बैकअप माना जाता है।' },
        { id: 'still-uploading', q: 'कुछ अभी भी अपलोड क्यों हो रहा है?', a: 'Settings → Uploads में दिखता है कि क्या रुका है और क्यों। ज़्यादातर वजह मोबाइल डेटा सेटिंग होती है: पहले से 100 MB तक की फ़ाइलें मोबाइल डेटा पर जाती हैं और बड़ी फ़ाइलें Wi-Fi का इंतज़ार करती हैं। ऑफ़लाइन होने या फ़ोन गर्म होने पर भी अपलोड रुकते हैं, और बाद में अपने-आप चलते हैं।' },
        { id: 'mobile-data', q: 'क्या Lens को मोबाइल डेटा से रोक सकते हैं?', a: 'हाँ। Settings → Uploads → Upload over mobile data: Everything, Up to 100 MB, या Wi-Fi only। छोटे प्रीव्यू हमेशा अपलोड होते हैं ताकि लाइब्रेरी अप-टू-डेट रहे; इनमें बहुत कम डेटा लगता है।' },
        { id: 'background', q: 'Lens बंद करने पर भी बैकअप चलता है?', a: 'हाँ, Android पर। ओरिजिनल अपलोड होते समय “Backing up 3 of 12” नोटिफ़िकेशन प्रोग्रेस दिखाता है। फ़ोन रीस्टार्ट हो या Android Lens बंद कर दे, तो बैकअप थोड़ी देर बाद अपने-आप फिर चलता है। Lens पूछे तो नोटिफ़िकेशन की इजाज़त दें।' },
        { id: 'video-while-recording', q: 'लंबे वीडियो अपलोड होने में बहुत समय लेते हैं?', a: 'Lens रिकॉर्डिंग चलते-चलते वीडियो अपलोड कर सकता है, इसलिए स्टॉप दबाने तक वह लगभग पूरा क्लाउड में होता है। Settings → Uploads → Upload videos while recording में चुनें: Wi-Fi only (पहले से), Wi-Fi + mobile data, या Off।' },
        { id: 'icons', q: 'फ़ोटो पर छोटे आइकन का क्या मतलब है?', a: 'तीर वाला ग्रे बादल: अपलोड का इंतज़ार। प्रतिशत: अपलोड हो रहा है। तीर वाला नीला बादल: हर जगह दिखता है, पूरा ओरिजिनल अभी अपलोड हो रहा है। टिक वाला बादल: ओरिजिनल क्लाउड में सुरक्षित है। लाल “!”: अपलोड नहीं हुआ; दोबारा कोशिश के लिए बैनर दबाएँ।' },
        { id: 'import', q: 'क्या पहले से मौजूद फ़ोटो का बैकअप ले सकते हैं?', a: 'हाँ। गैलरी में Import बटन दबाएँ और एक बार में 100 तक फ़ोटो और वीडियो चुनें। Lens उन्हें एक-एक करके पूरी क्वालिटी में बैकअप करता है। ओरिजिनल आपके फ़ोन की गैलरी में रहते हैं; Lens आपकी गैलरी को अपने-आप कभी स्कैन या अपलोड नहीं करता।' },
      ],
    },
    {
      id: 'space',
      icon: 'phone',
      title: 'फ़ोन में जगह',
      blurb: 'जगह ख़ाली करना, बिना इंटरनेट देखना',
      items: [
        { id: 'free-space', q: 'Lens फ़ोन में जगह कैसे ख़ाली करता है?', a: 'जब ओरिजिनल क्लाउड में सुरक्षित हो जाता है, Lens फ़ोन से बड़ी फ़ाइल हटाकर एक साफ़ प्रीव्यू रख सकता है। पहले से ओरिजिनल 7 दिन फ़ोन पर रहते हैं, और Lens हमेशा 2 GB जगह ख़ाली रखता है। दोनों Settings → On this device में बदलें।' },
        { id: 'free-now', q: 'मेरा फ़ोन अभी भरा हुआ है', a: 'Settings → On this device खोलें और “Free up space now” दबाएँ। जो भी ओरिजिनल क्लाउड में सुरक्षित है, वह तुरंत फ़ोन से हट जाता है। आपकी गैलरी पूरी रहती है।' },
        { id: 'never-lost', q: 'क्या Lens बिना बैकअप वाली चीज़ हटा सकता है?', a: 'नहीं। Lens किसी फ़ाइल को फ़ोन से तभी हटाता है जब क्लाउड की कॉपी उससे मिलाकर जाँच ली गई हो। जो अभी अपलोड के इंतज़ार में है, उसे कभी नहीं छुआ जाता।' },
        { id: 'offline', q: 'क्या बिना इंटरनेट फ़ोटो देख सकते हैं?', a: 'हाँ। गैलरी और प्रीव्यू हमेशा फ़ोन पर रहते हैं और ऑफ़लाइन चलते हैं। फ़ोटो खोलने पर पूरी क्वालिटी क्लाउड से आती है: Wi-Fi पर अपने-आप, और मोबाइल डेटा पर HD दबाने या ज़ूम करने पर।' },
      ],
    },
    {
      id: 'storage',
      icon: 'storage',
      title: 'स्टोरेज और प्लान',
      blurb: '100 GB मुफ़्त, अपना स्टोरेज',
      items: [
        { id: 'how-much', q: 'कितना मुफ़्त स्टोरेज मिलता है?', a: 'गेस्ट को 5 GB और साइन इन करने पर 100 GB, ओरिजिनल क्वालिटी में। आपके इनवाइट से जुड़ने वाला हर दोस्त 10 GB और जोड़ता है, कोई सीमा नहीं।', link: ['कीमत', 'pricing'] },
        { id: 'full', q: 'स्टोरेज भर जाए तो क्या होगा?', a: 'कुछ भी डिलीट नहीं होता। गेस्ट से 100 GB के लिए साइन इन करने को कहा जाता है। साइन इन हैं तो ज़्यादा जगह के लिए दोस्तों को इनवाइट करें या अपना स्टोरेज जोड़ें। गैलरी के नीचे स्टोरेज पिल दिखाता है कि कितना भरा है।' },
        { id: 'own-storage', q: 'क्या अपना Google Drive, OneDrive या Dropbox इस्तेमाल कर सकते हैं?', a: 'हाँ। गैलरी में स्टोरेज पिल (या Settings → Storage) दबाएँ, Google Drive, OneDrive, Dropbox, Box, S3-compatible बकेट या WebDAV/NAS फ़ोल्डर चुनें और साइन इन करें। उसके बाद नए ओरिजिनल सिर्फ़ वहीं जाते हैं, हर अपलोड के बाद जाँचे जाते हैं। वह भर जाए या साइन आउट हो जाए, तो ठीक होने तक Lens अपना स्टोरेज इस्तेमाल करता है।', link: ['अपना स्टोरेज इस्तेमाल करें', 'features/your-own-storage'] },
        { id: 'recent-saver', q: 'Storage में “Recent” और “Saver” क्या हैं?', a: 'आपके सबसे नए 20 GB Recent में रहते हैं, जो सबसे तेज़ है। पुरानी चीज़ें Saver में जाती हैं, जहाँ उन्हें कम ख़र्च में रखा जाता है। दोनों पूरी क्वालिटी में तुरंत खुलते हैं; इससे बस Lens मुफ़्त रह पाता है।' },
        { id: 'invite', q: 'इनवाइट कैसे काम करते हैं?', a: 'Settings → Invite & earn → Invite friends से आपको एक लिंक मिलता है। जब कोई दोस्त Lens इंस्टॉल करके अपने फ़ोन पर साइन इन करता है, आपको +10 GB मिलता है। हर व्यक्ति और हर फ़ोन एक बार गिना जाता है।' },
      ],
    },
    {
      id: 'delete',
      icon: 'trash',
      title: 'डिलीट और वापसी',
      blurb: 'ट्रैश, आर्काइव, शेयर की गई चीज़ें',
      items: [
        { id: 'mistake', q: 'ग़लती से कुछ डिलीट हो गया', a: 'Settings → Trash & Archive खोलें। डिलीट की गई चीज़ें 30 दिन ट्रैश में रहती हैं और Restore से तुरंत वापस आती हैं। उसके बाद वे एक साल के लिए आर्काइव में जाती हैं, जहाँ Recover से पूरा ओरिजिनल लगभग 12 घंटे में वापस आता है।' },
        { id: 'not-uploaded', q: 'जो अपलोड पूरा नहीं हुआ, क्या वह वापस मिल सकता है?', a: 'दुर्भाग्य से नहीं। डिलीट करने पर वह फ़ोन से हट जाता है, और ट्रैश में रखने के लिए क्लाउड में कोई कॉपी नहीं होती। डिलीट से पहले Lens इसकी चेतावनी देता है।' },
        { id: 'shared-delete', q: 'शेयर की हुई चीज़ डिलीट करने पर क्या होता है?', a: 'Lens आपसे पूछता है। “Delete for everyone” उसे आपके ट्रैश में भेजता है और दोस्तों को दिखना बंद हो जाता है। “Only for me” उसे आपकी लाइब्रेरी से हटाता है, पर दोस्तों के पास रहता है।' },
        { id: 'forever', q: 'किसी चीज़ को हमेशा के लिए कैसे डिलीट करें?', a: 'Settings → Trash & Archive में उसे चुनें और “Delete forever” दबाएँ। हर कॉपी हट जाती है और वह वापस नहीं आ सकती।' },
      ],
    },
    {
      id: 'web',
      icon: 'laptop',
      title: 'कंप्यूटर और शेयरिंग',
      blurb: 'वेब ऐप, QR साइन इन, दोस्त',
      items: [
        { id: 'computer', q: 'कंप्यूटर पर Lens कैसे इस्तेमाल करें?', a: 'lens.instagrowapp.com खोलें और साइन इन पर क्लिक करें। फ़ोन के Lens से QR कोड स्कैन करके Approve दबाएँ, या उसी ईमेल या Google अकाउंट से साइन इन करें। पूरी लाइब्रेरी ब्राउज़र में खुलती है और अपने-आप सिंक रहती है।', link: ['साइन इन', 'signin'] },
        { id: 'upload-computer', q: 'क्या कंप्यूटर से अपलोड कर सकते हैं?', a: 'हाँ। वेब ऐप में Upload पर क्लिक करें या फ़ोटो और वीडियो पेज पर खींचकर छोड़ें। वे पूरी क्वालिटी में अपलोड होते हैं और आपके फ़ोन पर भी दिखते हैं।' },
        { id: 'web-quality', q: 'ब्राउज़र में फ़ोटो छोटी क्यों दिखती है?', a: 'ब्राउज़र HEIC या RAW फ़ाइलें नहीं खोल पाते और अभी Lens के एडिट नहीं लगा पाते, इसलिए उनके लिए वेब ऐप 2048 पिक्सेल का साफ़ प्रीव्यू दिखाता है। “Open original” पूरी फ़ाइल डाउनलोड करता है। आम JPEG फ़ोटो पूरी क्वालिटी में दिखती हैं।' },
        { id: 'sign-out-computer', q: 'कंप्यूटर से साइन आउट कैसे करें?', a: 'कंप्यूटर पर: Settings → Sign out of this browser। फ़ोन से: Settings → Computers → Log out all computers, जैसे जब आपने किसी शेयर्ड या खोए हुए कंप्यूटर पर साइन इन किया हो।' },
        { id: 'friends', q: 'दोस्तों को फ़ोटो कैसे भेजें?', a: 'फ़ोटो या वीडियो चुनें → Send to friends, फिर उनका Lens नाम खोजें या Recent से चुनें। वे आपके दोस्त के Lens में Shared के अंदर दिखते हैं। ओरिजिनल अपलोड पूरा होने के बाद ही चीज़ें भेजी जा सकती हैं।' },
        { id: 'share-out', q: 'WhatsApp, Instagram वग़ैरह पर कैसे शेयर करें?', a: 'फ़ोटो या वीडियो खोलें और Share दबाएँ, या फ़ोन की गैलरी में कॉपी रखने के लिए Save to Photos। ओरिजिनल सिर्फ़ क्लाउड में हो तो Lens पहले उसे डाउनलोड करता है। एडिट साथ जाते हैं।' },
      ],
    },
    {
      id: 'account',
      icon: 'person',
      title: 'अकाउंट और प्राइवेसी',
      blurb: 'साइन-इन कोड, नया फ़ोन, डिलीट',
      items: [
        { id: 'new-phone', q: 'नए फ़ोन पर अपनी फ़ोटो कैसे पाएँ?', a: 'Lens इंस्टॉल करें और उसी ईमेल या Google अकाउंट से साइन इन करें। पूरी लाइब्रेरी आ जाती है: पहले प्रीव्यू, खोलने पर पूरे ओरिजिनल। फ़ोन से फ़ोन कुछ कॉपी नहीं करना पड़ता।' },
        { id: 'code', q: 'साइन-इन कोड नहीं आया', a: 'Lens के ईमेल के लिए स्पैम या प्रमोशन फ़ोल्डर देखें। कोड 10 मिनट चलता है और एक घंटे में 5 कोड तक माँग सकते हैं। अस्थायी या डिस्पोज़ेबल ईमेल पते नहीं चलते; अपना आम ईमेल या Continue with Google इस्तेमाल करें।' },
        { id: 'log-out', q: 'ऐप से लॉग आउट कैसे करें?', a: 'Settings → Account → Log out। Lens यह तभी करने देता है जब सब कुछ अपलोड हो चुका हो, ताकि कुछ न खोए। “Log out other devices” बाक़ी सभी फ़ोन एक साथ साइन आउट करता है।' },
        { id: 'privacy', q: 'मेरी फ़ोटो कौन देख सकता है?', a: 'सिर्फ़ आप, और वे दोस्त जिन्हें आप चीज़ें भेजते हैं। Lens आपका डेटा नहीं बेचता, आपकी फ़ोटो नहीं देखता और उनसे AI ट्रेन नहीं करता। फ़ाइलें भेजते समय और रखते समय एन्क्रिप्ट रहती हैं।', link: ['प्राइवेसी और सुरक्षा', 'security'] },
        { id: 'delete-account', q: 'अपना अकाउंट कैसे डिलीट करें?', a: 'Settings में “Delete account and data” दबाएँ, फ़ोन पर या वेबसाइट पर। आपके साइन-इन तुरंत रद्द होते हैं, और फिर आपकी सारी फ़ोटो, वीडियो, शेयर और जानकारी हमेशा के लिए डिलीट हो जाती है।', link: ['क्या डिलीट होता है', 'delete-account'] },
      ],
    },
  ],
};
