// Interface text in English and Hindi. Page content lives in src/content/.
export type Lang = 'en' | 'hi';
export const LANGS: Lang[] = ['en', 'hi'];
export const BRAND = 'Lens by InstaGrow';

/** Path for a page in a language: English at the root, Hindi under /hi/. */
export function href(lang: Lang, path = ''): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const base = lang === 'en' ? '/' : '/hi/';
  return clean ? `${base}${clean}/` : base;
}

export const ui = {
  en: {
    skip: 'Skip to content',
    nav: { features: 'Features', pricing: 'Pricing', security: 'Privacy & security', help: 'Help' },
    signIn: 'Sign in',
    openApp: 'Open web app',
    getApp: 'Get the app',
    comingSoon: 'Coming soon on Google Play',
    language: 'हिंदी',
    languageLabel: 'Read this page in Hindi',
    footer: {
      product: 'Product',
      company: 'Legal',
      useCases: 'Use cases',
      guides: 'Guides',
      allGuides: 'All guides',
      made: 'Shoot endlessly. Your phone never fills up.',
    },
    breadcrumbHome: 'Home',
    faqTitle: 'Questions',
    related: 'More features',
    learnMore: 'Learn more',
    ctaTitle: 'Never run out of space for memories again',
    ctaBody: 'Full-quality backup with 40 GB free to start, a pro camera and a web app, in one place.',
  },
  hi: {
    skip: 'सामग्री पर जाएँ',
    nav: { features: 'फ़ीचर', pricing: 'कीमत', security: 'प्राइवेसी और सुरक्षा', help: 'मदद' },
    signIn: 'साइन इन',
    openApp: 'वेब ऐप खोलें',
    getApp: 'ऐप पाएँ',
    comingSoon: 'जल्द ही Google Play पर',
    language: 'English',
    languageLabel: 'यह पेज अंग्रेज़ी में पढ़ें',
    footer: {
      product: 'प्रोडक्ट',
      company: 'कानूनी',
      useCases: 'इस्तेमाल',
      guides: 'गाइड',
      allGuides: 'सभी गाइड',
      made: 'जितनी चाहें फ़ोटो लें। फ़ोन कभी फ़ुल नहीं होगा।',
    },
    breadcrumbHome: 'होम',
    faqTitle: 'सवाल-जवाब',
    related: 'और फ़ीचर',
    learnMore: 'और जानें',
    ctaTitle: 'यादों के लिए जगह फिर कभी कम नहीं पड़ेगी',
    ctaBody: 'फ़ुल क्वालिटी बैकअप, शुरुआत में 40 GB मुफ़्त, प्रो कैमरा और वेब ऐप, सब एक जगह।',
  },
} as const;
