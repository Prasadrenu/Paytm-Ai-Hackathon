// Small line-icon set (24px grid, stroke only, Lucide-style paths). Inherits colour from the text.
const P = {
  menu: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  review: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  saved: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  payments: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h3" /></>,
  analytics: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  plan: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="M9 2.5v3M15 2.5v3M8 11h8M8 15h5" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m21 16-5-5-8 8" /></>,
  camera: <><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  sunrise: <path d="M12 3v5M5.6 9.6l1.4 1.4M18.4 9.6 17 11M2 17h3M19 17h3M7 17a5 5 0 0 1 10 0M3 21h18M9 6l3-3 3 3" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  sunset: <path d="M12 9V3M5.6 9.6l1.4 1.4M18.4 9.6 17 11M2 17h3M19 17h3M7 17a5 5 0 0 1 10 0M3 21h18M9 6l3 3 3-3" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  weather: <><path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 11a3.5 3.5 0 0 1-.5 7z" /></>,
  thermo: <path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z" />,
  rain: <path d="M7 15a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 8a3.5 3.5 0 0 1-.5 7M8 19l-1 2M12 19l-1 2M16 19l-1 2" />,
  volume: <path d="M4 9.5v5h4l5 4v-13l-5 4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  event: <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />,
}

export default function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={'icon ' + className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name] || P.clock}
    </svg>
  )
}
