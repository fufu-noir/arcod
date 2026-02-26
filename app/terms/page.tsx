'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
    return (
        <div className='w-full max-w-3xl mx-auto'>
            <Link href='/'>
                <Button variant='ghost' className='mb-4'>
                    <ArrowLeft className='mr-2 h-4 w-4' />
                    Back to Home
                </Button>
            </Link>

            <Card className='bg-background/80 backdrop-blur-sm'>
                <CardHeader>
                    <CardTitle className='text-2xl'>Terms of Use & Disclaimer</CardTitle>
                </CardHeader>
                <CardContent className='space-y-6 text-muted-foreground'>
                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-2'>1. Intended Use</h2>
                        <p>
                            This website is provided as a tool for users who legally own the rights to the music they 
                            download. You are free to use this service only if you have the legal right to access and 
                            download the content in question, such as music you have purchased or content you own the 
                            rights to.
                        </p>
                    </section>

                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-2'>2. Educational & Research Purposes</h2>
                        <p>
                            This platform may also be used for educational and research purposes, including but not 
                            limited to studying audio formats, compression technologies, metadata handling, and music 
                            streaming infrastructure. Users engaging with this tool for educational purposes should 
                            ensure their activities comply with applicable laws and regulations.
                        </p>
                    </section>

                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-2'>3. Disclaimer of Liability</h2>
                        <p>
                            The administrator(s) and developer(s) of this website are <strong>not responsible</strong> for 
                            any misuse of this service. This includes, but is not limited to, users downloading music or 
                            other content for which they do not hold the necessary rights or licenses.
                        </p>
                        <p className='mt-2'>
                            By using this website, you acknowledge and agree that:
                        </p>
                        <ul className='list-disc list-inside mt-2 space-y-1'>
                            <li>You are solely responsible for ensuring you have the legal right to download any content.</li>
                            <li>The website administrators bear no liability for copyright infringement or any other 
                                illegal activity conducted by users.</li>
                            <li>Any legal consequences arising from the misuse of this service are the sole 
                                responsibility of the user.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-2'>4. No Warranty</h2>
                        <p>
                            This service is provided &quot;as is&quot; without any warranties, express or implied. The 
                            administrators make no guarantees regarding the availability, reliability, or accuracy of 
                            the service.
                        </p>
                    </section>

                    <section>
                        <h2 className='text-lg font-semibold text-foreground mb-2'>5. Acceptance of Terms</h2>
                        <p>
                            By accessing and using this website, you confirm that you have read, understood, and agree 
                            to be bound by these terms. If you do not agree with any part of these terms, you should 
                            not use this service.
                        </p>
                    </section>

                    <div className='pt-4 border-t text-sm text-muted-foreground/70'>
                        <p>Last updated: December 2025</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
