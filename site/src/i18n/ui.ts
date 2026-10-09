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
      made: 'Made in India. Your photos are stored in AWS Mumbai (India).',
    },
    breadcrumbHome: 'Home',
    faqTitle: 'Questions',
    related: 'More features',
    learnMore: 'Learn more',
    ctaTitle: 'Never run out of space for memories again',
    ctaBody: 'Free 100 GB backup at original quality, a pro camera and a web app, in one place.',
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
      made: 'भारत में बना। आपकी फ़ोटो AWS मुंबई (भारत) में सुरक्षित रहती हैं।',
    },
    breadcrumbHome: 'होम',
    faqTitle: 'सवाल-जवाब',
    related: 'और फ़ीचर',
    learnMore: 'और जानें',
    ctaTitle: 'यादों के लिए जगह फिर कभी कम नहीं पड़ेगी',
    ctaBody: 'ओरिजिनल क्वालिटी में 100 GB मुफ़्त बैकअप, प्रो कैमरा और वेब ऐप, सब एक जगह।',
  },
} as const;
