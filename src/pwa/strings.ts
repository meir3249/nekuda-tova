// All user-facing UI text (Q-01: Hebrew, RTL). Draft copy for review (Q-05).
// The product name appears only in `appName`; it is the notification title (D-003), never part of a body.

export const PRODUCT_NAME = 'נקודה טובה'

export const strings = {
  appName: PRODUCT_NAME,
  subtitle: 'מחשבה קטנה וטובה, פעם ביום.',

  timeLabel: 'שעת התראה',

  notificationsLabel: 'התראות',
  notificationsOn: 'פועלות',
  notificationsOff: 'כבויות',

  saved: 'נשמר',
  saveFailed: 'לא הצלחנו לשמור כרגע. ננסה שוב.',
  saveRejected: 'לא הצלחנו לשמור את השינוי הזה.',
  capacityReached: 'אי אפשר להצטרף כרגע. אפשר לנסות שוב מאוחר יותר.',
  pushComingSoon: 'הפעלת התראות תהיה זמינה בקרוב.',

  howItWorksTitle: 'איך זה עובד',
  howItWorks: [
    'פעם ביום, בשעה שבחרת, מגיעה מחשבה קטנה אחת. משהו שכבר ידעת, ואולי קצת שכחת.',
    'ההודעה מגיעה בסביבות השעה שבחרת, ולפעמים קצת אחריה. אם היא מתעכבת יותר משעתיים, מוותרים על אותו יום ולא משלימים.',
    'אולי להתקשר למישהו שאוהבים. אולי לעצור לנשימה, ללכת לים, או פשוט לשים לב לרגע.',
    'אין כאן רצפים, ניקוד או הישגים. לא צריך לענות, לא צריך לפתוח את האפליקציה, ואין שום רגשות אשם אם יום אחד עובר בלי.',
    'אין חשבון ואין שם. נשמרים רק מזהה אנונימי, השעה שבחרת, אזור הזמן, כתובת ההתראות של המכשיר, ורישום טכני של מועדי השליחה (בלי תוכן ההודעות). כיבוי ההתראות מוחק את כתובת ההתראות.',
  ],

  privacyLink: 'פרטיות',
} as const

export type StringKey = keyof typeof strings
