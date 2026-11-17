import './globals.css';

export const metadata = {
  title: 'TaskLedger',
  description: 'Task monitoring and staff allocation',
};
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved light/dark style before the page paints (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: "try{var s=localStorage.getItem('tl-style')||'" + (process.env.NEXT_PUBLIC_DEFAULT_STYLE || 'light') + "';if(s==='dark')document.documentElement.dataset.style='dark'}catch(e){}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
