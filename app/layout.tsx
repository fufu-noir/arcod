import ParticlesComponent from '@/components/particles';
import SettingsForm from '@/components/ui/settings-form';
import StatusBarContainer from '@/components/status-bar/container';
import { Button } from '@/components/ui/button';
import { FFmpegProvider } from '@/lib/ffmpeg-provider';
import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import { SettingsProvider } from '@/lib/settings-provider';
import { StatusBarProvider } from '@/lib/status-bar/context';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { CountryProvider } from '@/lib/country-provider';
import { AuthProvider } from '@/components/auth-provider';
import { NavUser } from '@/components/nav-user';
import { HistoryPanelProvider } from '@/lib/history-panel-context';
import { HistoryPanelWrapper } from '@/components/history-panel-wrapper';
import { DownloadModeProvider } from '@/lib/download-mode-provider';
import { LibraryProvider } from '@/lib/library-provider';
import { MusicSourceProvider } from '@/lib/music-source-provider';
import SplashScreen from '@/components/splash-screen';
import GoogleAnalytics from '@/components/google-analytics';
import localFont from 'next/font/local';
import Link from 'next/link';
import './globals.css';

const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-inter'
});

const meub = localFont({
    src: '../public/logo/MEUB.otf',
    variable: '--font-meub',
    display: 'swap'
});

const APP_NAME = 'arcod';
const APP_DESCRIPTION = 'Music Downloader';

export const metadata: Metadata = {
    metadataBase: new URL('https://arcod.app'), // Updated Site URL
    title: {
        default: 'arcod - Music Downloader',
        template: `%s | ${APP_NAME}`
    },
    description: APP_DESCRIPTION,
    icons: {
        icon: '/logo/arcod_logo.svg',
        shortcut: '/logo/arcod_logo.svg',
        apple: '/logo/arcod_logo.svg',
    },
    openGraph: {
        title: APP_NAME,
        description: APP_DESCRIPTION,
        images: [{ url: '/logo/arcod_logo.svg', width: 1200, height: 630, alt: 'Arcod Logo' }]
    },
    keywords: ['arcod', 'music', 'downloader', 'hi-res', 'flac', 'alac', 'mp3', 'aac', 'opus', 'wav']
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang='en' suppressHydrationWarning className={`${inter.variable} ${meub.variable}`}>
            <body className={`${inter.className} antialiased`} suppressHydrationWarning>
                <GoogleAnalytics />
                <SplashScreen />
                <FFmpegProvider>
                    <CountryProvider>
                        <StatusBarProvider>
                            <SettingsProvider>
                                <DownloadModeProvider>
                                    <MusicSourceProvider>
                                        <AuthProvider>
                                            <LibraryProvider>
                                                <HistoryPanelProvider>
                                                    <ThemeProvider attribute='class' defaultTheme='dark' enableSystem>
                                                        <ParticlesComponent className='z-[-1] h-full w-full fixed' />
                                                        <div className='fixed top-0 left-0 right-0 flex justify-center md:justify-end items-center p-4 md:p-6 z-[20]'>
                                                            <div className='flex gap-1.5 items-center bg-card/40 px-2 md:px-3 py-1.5 border border-border/40 shadow-xl rounded-[25px] overflow-hidden'>
                                                                <NavUser />
                                                                <div className='flex gap-1 items-center border-l border-border/50 ml-1 pl-1'>
                                                                    {/* Credits - Icon on mobile, text on desktop */}
                                                                    <Link href='/credits'>
                                                                        <Button variant='ghost' size='sm' className='h-8 w-8 sm:w-auto p-0 sm:px-3 text-muted-foreground hover:text-foreground transition-colors rounded-full'>
                                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 sm:hidden">
                                                                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                                                                <circle cx="9" cy="7" r="4" />
                                                                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                                                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                                                            </svg>
                                                                            <span className='hidden sm:inline text-[11px] font-semibold'>Credits</span>
                                                                        </Button>
                                                                    </Link>
                                                                    {/* Terms - Icon on mobile, text on desktop */}
                                                                    <Link href='/terms'>
                                                                        <Button variant='ghost' size='sm' className='h-8 w-8 sm:w-auto p-0 sm:px-3 text-muted-foreground hover:text-foreground transition-colors rounded-full'>
                                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 sm:hidden">
                                                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                                                <polyline points="14 2 14 8 20 8" />
                                                                                <line x1="16" y1="13" x2="8" y2="13" />
                                                                                <line x1="16" y1="17" x2="8" y2="17" />
                                                                                <polyline points="10 9 9 9 8 9" />
                                                                            </svg>
                                                                            <span className='hidden sm:inline text-[11px] font-semibold'>Terms</span>
                                                                        </Button>
                                                                    </Link>
                                                                    {/* Discord - Always icon */}
                                                                    <a href='https://discord.gg/hgC6ZegbKD' target='_blank' rel='noopener noreferrer'>
                                                                        <Button variant='ghost' size='sm' className='h-8 w-8 p-0 text-muted-foreground hover:text-foreground transition-colors rounded-full'>
                                                                            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                                                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                                                                            </svg>
                                                                        </Button>
                                                                    </a>
                                                                    {/* Ko-fi - Donation button */}
                                                                    <a href='https://ko-fi.com/arcod' target='_blank' rel='noopener noreferrer'>
                                                                        <Button variant='ghost' size='sm' className='h-8 w-8 p-0 text-muted-foreground hover:text-foreground transition-colors rounded-full'>
                                                                            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                                                                <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.903.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z" />
                                                                            </svg>
                                                                        </Button>
                                                                    </a>
                                                                    {/* Settings button */}
                                                                    <SettingsForm />
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className='flex flex-col min-h-screen'>
                                                            <main className='px-4 md:px-6 pb-24 pt-28 md:pt-32 2xl:pt-48 min-h-full flex-1 flex flex-col items-center gap-6 z-[2] overflow-x-hidden w-full'>
                                                                {children}
                                                            </main>
                                                            <Toaster />
                                                            <StatusBarContainer />
                                                        </div>
                                                        <HistoryPanelWrapper />
                                                    </ThemeProvider>
                                                </HistoryPanelProvider>
                                            </LibraryProvider>
                                        </AuthProvider>
                                    </MusicSourceProvider>
                                </DownloadModeProvider>
                            </SettingsProvider>
                        </StatusBarProvider>
                        <script src='https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.9.7/dist/ffmpeg.min.js'></script>
                        <script src='https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js'></script>
                    </CountryProvider>
                </FFmpegProvider>
            </body>
        </html>
    );
}
