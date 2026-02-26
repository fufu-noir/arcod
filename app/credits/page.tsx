'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FaDiscord } from '@react-icons/all-files/fa/FaDiscord';
import { FaGithub } from '@react-icons/all-files/fa/FaGithub';
import ChangelogDialog from '@/components/ui/changelog-dialog';

export default function CreditsPage() {
    return (
        <div className='w-full max-w-2xl mx-auto'>
            <Link href='/'>
                <Button variant='ghost' className='mb-4'>
                    <ArrowLeft className='mr-2 h-4 w-4' />
                    Back to Home
                </Button>
            </Link>

            <Card className='bg-background/80 backdrop-blur-sm'>
                <CardHeader>
                    <CardTitle className='text-2xl'>Credits</CardTitle>
                </CardHeader>
                <CardContent className='space-y-6'>
                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-3'>Community</h2>
                        <div className='flex flex-col gap-3'>
                            <a href='https://discord.gg/rhUUKQagjA' target='_blank' rel='noopener noreferrer'>
                                <Button variant='outline' className='w-full justify-start gap-3'>
                                    <FaDiscord className='h-5 w-5' />
                                    Qobuz-DL Discord
                                </Button>
                            </a>
                            <a href='https://discord.gg/invite/GN7GnntyQ2' target='_blank' rel='noopener noreferrer'>
                                <Button variant='outline' className='w-full justify-start gap-3'>
                                    <FaDiscord className='h-5 w-5' />
                                    Squidboard Discord
                                </Button>
                            </a>
                        </div>
                    </section>

                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-3'>Updates</h2>
                        <ChangelogDialog />
                    </section>

                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-3'>Source Code</h2>
                        <a href='https://github.com/QobuzDL/Qobuz-DL' target='_blank' rel='noopener noreferrer'>
                            <Button variant='outline' className='w-full justify-start gap-3'>
                                <FaGithub className='h-5 w-5' />
                                GitHub Repository
                            </Button>
                        </a>
                    </section>

                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-3'>About</h2>
                        <p className='text-muted-foreground'>
                            Arcod is an open-source browser-based client for downloading music from Qobuz.
                            It is a fork of the original <a href='https://github.com/QobuzDL/Qobuz-DL' target='_blank' rel='noopener noreferrer' className='text-foreground underline decoration-border hover:decoration-foreground transition-colors'>Qobuz-DL</a> project.
                            Built with Next.js, React, and TailwindCSS.
                        </p>
                    </section>
                </CardContent>
            </Card>
        </div>
    );
}
